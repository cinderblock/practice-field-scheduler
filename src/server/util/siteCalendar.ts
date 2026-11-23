/**
 * Parse the site's own calendar (an iCalendar feed, such as a Google Calendar's secret iCal
 * address) into the events the reservation calendar shows. Pure: no fetching, no env.
 *
 * Repeating events are expanded into one entry per occurrence, with edited occurrences
 * (RECURRENCE-ID) and cancelled ones (EXDATE, or STATUS:CANCELLED) applied.
 */

import { TZDateMini } from "@date-fns/tz";
import ICAL from "ical.js";
import type { EventDate, SiteCalendarEvent } from "~/types";

/**
 * A runaway rule (say, every minute forever) mustn't hang the server. Iteration starts at the
 * series' first occurrence, so the first cap leaves room for a long-running daily series to reach
 * the window (~27 years); the second bounds what one series can put on the page.
 */
const MaxIterationsPerEvent = 10_000;
const MaxOccurrencesPerEvent = 1000;
/** An event spanning more days than this is listed on its first this-many days only */
const MaxDaysPerEvent = 31;

export type SiteCalendarWindow = {
	/** Only events that end after this instant */
	from: Date;
	/** Only events that start before this instant */
	until: Date;
	/** The site's IANA time zone, which all dates are in */
	timeZone: string;
};

function isTimeZone(tzid: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tzid });
		return true;
	} catch {
		return false;
	}
}

/**
 * The instant an iCalendar time stands for.
 *
 * UTC times and times whose zone the feed defines (a VTIMEZONE, as Google includes) are converted
 * by ical.js. Anything else is read as a wall clock time: in `tzid` (the property's TZID, which
 * ical.js forgets when the feed doesn't define it) if that's a real IANA zone, otherwise in the
 * site's zone. That never depends on the server's own time zone.
 */
function toInstant(time: ICAL.Time, timeZone: string, tzid?: string): number {
	const zone = time.zone;
	if (zone && (zone.tzid === "UTC" || zone.component)) return time.toUnixTime() * 1000;

	const tz = tzid && isTimeZone(tzid) ? tzid : timeZone;
	return new TZDateMini(time.year, time.month - 1, time.day, time.hour, time.minute, time.second, tz).getTime();
}

/** The TZID parameter on one of an event's date properties, if any */
function tzidOf(event: ICAL.Event, property: "dtstart" | "dtend"): string | undefined {
	const value = event.component.getFirstProperty(property)?.getParameter("tzid");
	return typeof value === "string" ? value : undefined;
}

/** A DATE value (no time) as YYYY-MM-DD */
function dateValue(time: ICAL.Time): EventDate {
	const pad = (n: number, width = 2) => n.toString().padStart(width, "0");
	return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
}

function localDate(instant: number, timeZone: string): EventDate {
	return new Date(instant).toLocaleDateString("en-CA", { timeZone });
}

function addDays(date: EventDate, days: number): EventDate {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** The instant a date begins in the site's zone */
function midnight(date: EventDate, timeZone: string): number {
	const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
	return new TZDateMini(year, month - 1, day, timeZone).getTime();
}

/** Every date from `first` to `last`, inclusive, capped at MaxDaysPerEvent */
function datesBetween(first: EventDate, last: EventDate): EventDate[] {
	const dates = [first];
	let date = first;
	while (date < last && dates.length < MaxDaysPerEvent) {
		date = addDays(date, 1);
		dates.push(date);
	}
	return dates;
}

function isCancelled(event: ICAL.Event): boolean {
	return String(event.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

function toSiteEvent(
	event: ICAL.Event,
	start: ICAL.Time,
	end: ICAL.Time,
	id: string,
	timeZone: string,
): SiteCalendarEvent {
	const title = event.summary?.trim() || "Event";

	if (start.isDate) {
		// All-day: DTEND is the (exclusive) day after the last one. A missing or equal end is one day.
		const first = dateValue(start);
		const afterLast = end.isDate && dateValue(end) > first ? dateValue(end) : addDays(first, 1);

		return {
			id,
			title,
			allDay: true,
			start: midnight(first, timeZone),
			end: midnight(afterLast, timeZone),
			dates: datesBetween(first, addDays(afterLast, -1)),
		};
	}

	const startTzid = tzidOf(event, "dtstart");
	const startInstant = toInstant(start, timeZone, startTzid);
	// With DURATION instead of DTEND, the end is in the start's zone
	const endInstant = Math.max(toInstant(end, timeZone, tzidOf(event, "dtend") ?? startTzid), startInstant);
	// An event ending exactly at midnight doesn't touch the next day
	const lastInstant = endInstant > startInstant ? endInstant - 1 : startInstant;

	return {
		id,
		title,
		allDay: false,
		start: startInstant,
		end: endInstant,
		dates: datesBetween(localDate(startInstant, timeZone), localDate(lastInstant, timeZone)),
	};
}

function eventId(event: ICAL.Event, occurrence: ICAL.Time | null): string {
	const uid = event.uid || `${event.summary ?? ""}@${event.startDate?.toString() ?? ""}`;
	return occurrence ? `${uid}/${occurrence.toString()}` : uid;
}

/**
 * The events in an iCalendar feed that overlap the window, one per occurrence, sorted by start.
 *
 * Throws if the text isn't iCalendar.
 */
export function parseSiteCalendar(ics: string, { from, until, timeZone }: SiteCalendarWindow): SiteCalendarEvent[] {
	const calendar = new ICAL.Component(ICAL.parse(ics));
	if (calendar.name !== "vcalendar") throw new Error(`Expected a VCALENDAR, got ${calendar.name.toUpperCase()}`);

	const fromMs = from.getTime();
	const untilMs = until.getTime();
	const overlaps = (e: SiteCalendarEvent) => e.end > fromMs && e.start < untilMs;

	const masters = new Map<string, ICAL.Event>();
	const exceptions: ICAL.Event[] = [];
	const singles: ICAL.Event[] = [];

	for (const component of calendar.getAllSubcomponents("vevent")) {
		const event = new ICAL.Event(component);
		if (!event.startDate) continue;
		if (event.isRecurrenceException()) exceptions.push(event);
		else if (event.isRecurring() && event.uid) masters.set(event.uid, event);
		else singles.push(event);
	}

	// An edited occurrence belongs to its series; without one (the series was deleted, or is outside
	// what the feed exported) it stands on its own
	for (const exception of exceptions) {
		const master = masters.get(exception.uid);
		if (master) master.relateException(exception);
		else singles.push(exception);
	}

	const events: SiteCalendarEvent[] = [];

	for (const event of singles) {
		if (isCancelled(event)) continue;
		const siteEvent = toSiteEvent(event, event.startDate, event.endDate, eventId(event, null), timeZone);
		if (overlaps(siteEvent)) events.push(siteEvent);
	}

	for (const master of masters.values()) {
		const iterator = master.iterator();
		let shown = 0;
		for (let i = 0; i < MaxIterationsPerEvent && shown < MaxOccurrencesPerEvent; i++) {
			const occurrence = iterator.next();
			if (!occurrence) break;
			// Occurrences come in order of their original start, so the rest are past the window too
			if (toInstant(occurrence, timeZone, tzidOf(master, "dtstart")) >= untilMs) break;

			const details = master.getOccurrenceDetails(occurrence);
			if (isCancelled(details.item)) continue;

			const siteEvent = toSiteEvent(
				details.item,
				details.startDate,
				details.endDate,
				eventId(master, details.recurrenceId),
				timeZone,
			);
			if (!overlaps(siteEvent)) continue;
			events.push(siteEvent);
			shown++;
		}
	}

	return events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
