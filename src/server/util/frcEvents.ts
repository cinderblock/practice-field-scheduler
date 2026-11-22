/**
 * Pure helpers for our teams' FRC events: normalizing FIRST's event records, the calendar's
 * "teams competing" breaks, the /events page's week rows, and lookups for team prioritization.
 *
 * No I/O here, so it is safe to import from client components and easy to test.
 */

import { z } from "zod";
import type { EventDate, FrcEvent, FrcEventsSnapshot, FrcSeasonWeek, Team } from "~/types";

////// FIRST's event records //////

/** Everything about an event except which of our teams are going */
export type FrcEventInfo = Omit<FrcEvent, "teams">;

const DatePrefix = /^(\d{4}-\d{2}-\d{2})/;

/**
 * One record from FIRST's `/{season}/events`. Only the fields used here, and lenient about nulls:
 * FIRST leaves plenty of them empty, especially on off-season events.
 */
const ApiEvent = z.object({
	code: z.string().min(1),
	name: z.string().min(1),
	type: z.string().nullish(),
	weekNumber: z.number().int().nullish(),
	// Local to the event, with no zone: "2027-03-04T00:00:00"
	dateStart: z.string().regex(DatePrefix),
	dateEnd: z.string().regex(DatePrefix),
	venue: z.string().nullish(),
	city: z.string().nullish(),
	stateprov: z.string().nullish(),
	country: z.string().nullish(),
	website: z.string().nullish(),
});

const EventListing = z.object({ Events: z.array(z.unknown()) });

export class UnexpectedEventListingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnexpectedEventListingError";
	}
}

/**
 * Event types that count toward a competition week. FIRST numbers its weeks for these; other
 * types (off-season, Championship) carry a week number too, but it doesn't mean the same thing.
 */
const WeekEventTypes = new Set([
	"Regional",
	"DistrictEvent",
	"DistrictChampionship",
	"DistrictChampionshipWithLevels",
	"DistrictChampionshipDivision",
]);

/** The Championship and its divisions, shown as a group of their own after the weeks */
export const ChampionshipEventTypes = new Set(["Championship", "ChampionshipDivision", "ChampionshipSubdivision"]);

function datePart(value: string): EventDate {
	return DatePrefix.exec(value)?.[1] ?? value;
}

/**
 * Parse the body of FIRST's event listing into events. Records that don't fit are dropped
 * rather than failing the lot: one odd off-season entry shouldn't hide the season.
 */
export function parseEventListing(body: unknown, season: number): FrcEventInfo[] {
	const listing = EventListing.safeParse(body);
	if (!listing.success) throw new UnexpectedEventListingError(`Unexpected event listing for ${season}`);

	return listing.data.Events.flatMap(record => {
		const parsed = ApiEvent.safeParse(record);
		if (!parsed.success) return [];
		const event = parsed.data;
		const type = event.type ?? "None";

		return [
			{
				season,
				code: event.code.toUpperCase(),
				name: event.name.trim(),
				type,
				week: WeekEventTypes.has(type) && event.weekNumber != null ? event.weekNumber : null,
				start: datePart(event.dateStart),
				end: datePart(event.dateEnd),
				venue: event.venue ?? "",
				city: event.city ?? "",
				stateProv: event.stateprov ?? "",
				country: event.country ?? "",
				...(event.website ? { website: event.website } : {}),
			},
		];
	});
}

function eventKey({ season, code }: Pick<FrcEvent, "season" | "code">) {
	return `${season}:${code}`;
}

/** Chronological, then by name, so the order is stable across refreshes */
export function compareEvents(a: FrcEventInfo, b: FrcEventInfo): number {
	return a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.name.localeCompare(b.name);
}

/** Combine each team's event list into one list of events, each naming the teams registered */
export function mergeRegistrations(perTeam: Iterable<readonly [Team, readonly FrcEventInfo[]]>): FrcEvent[] {
	const events = new Map<string, FrcEvent>();

	for (const [team, list] of perTeam) {
		for (const info of list) {
			const key = eventKey(info);
			const event = events.get(key) ?? { ...info, teams: [] };
			if (!event.teams.includes(team)) event.teams.push(team);
			events.set(key, event);
		}
	}

	return [...events.values()]
		.map(event => ({ ...event, teams: event.teams.sort((a, b) => a - b) }))
		.sort(compareEvents);
}

/** The dates each competition week spans, from every event that week */
export function seasonWeeks(season: number, events: readonly FrcEventInfo[]): FrcSeasonWeek[] {
	const weeks = new Map<number, FrcSeasonWeek>();

	for (const event of events) {
		if (event.week === null || event.season !== season) continue;
		const week = weeks.get(event.week);
		if (!week) {
			weeks.set(event.week, { season, week: event.week, start: event.start, end: event.end });
			continue;
		}
		if (event.start < week.start) week.start = event.start;
		if (event.end > week.end) week.end = event.end;
	}

	return [...weeks.values()].sort((a, b) => a.week - b.week);
}

////// Links //////

/** The Blue Alliance and Statbotics both key events as `<season><code>`, lowercase */
export function eventLinks({ season, code }: Pick<FrcEvent, "season" | "code">): { tba: string; statbotics: string } {
	const key = `${season}${code.toLowerCase()}`;
	return {
		tba: `https://www.thebluealliance.com/event/${key}`,
		statbotics: `https://www.statbotics.io/event/${key}`,
	};
}

////// The calendar's breaks //////

/**
 * Where the calendar draws a "teams competing" break: before the first day of each group of
 * overlapping events, so a weekend with several events gets one break listing them all.
 *
 * `dates` are the calendar's days, ascending and consecutive. A group already under way on the
 * first day gets its break before that day; groups entirely outside the dates get none.
 */
export function placeEventBreaks(dates: readonly EventDate[], events: readonly FrcEvent[]): Map<EventDate, FrcEvent[]> {
	const breaks = new Map<EventDate, FrcEvent[]>();
	const first = dates[0];
	const last = dates[dates.length - 1];
	if (first === undefined || last === undefined) return breaks;

	const visible = events.filter(event => event.end >= first && event.start <= last).sort(compareEvents);

	let group: FrcEvent[] = [];
	let groupEnd = "";

	const flush = () => {
		const start = group[0]?.start;
		if (start === undefined) return;
		const at = dates.find(date => date >= start);
		if (at !== undefined) breaks.set(at, group);
	};

	for (const event of visible) {
		if (group.length && event.start > groupEnd) {
			flush();
			group = [];
		}
		group.push(event);
		if (event.end > groupEnd) groupEnd = event.end;
	}
	flush();

	return breaks;
}

/** Earliest start and latest end of some events */
export function eventsSpan(events: readonly FrcEvent[]): { start: EventDate; end: EventDate } | undefined {
	const first = events[0];
	if (!first) return undefined;
	let { start, end } = first;
	for (const event of events) {
		if (event.start < start) start = event.start;
		if (event.end > end) end = event.end;
	}
	return { start, end };
}

////// Dates //////

const MonthDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const WeekdayMonthDay = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	weekday: "short",
	month: "short",
	day: "numeric",
});
const MonthYear = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

function utcNoon(date: EventDate) {
	return new Date(`${date}T12:00:00Z`);
}

/** "Mar 4 – 7", "Feb 26 – Mar 1", or "Mar 4" for a single day */
export function formatDateRange(start: EventDate, end: EventDate, { weekday = false } = {}): string {
	const format = weekday ? WeekdayMonthDay : MonthDay;
	if (start === end) return format.format(utcNoon(start));
	if (!weekday && start.slice(0, 7) === end.slice(0, 7)) {
		return `${MonthDay.format(utcNoon(start))} – ${utcNoon(end).getUTCDate()}`;
	}
	return `${format.format(utcNoon(start))} – ${format.format(utcNoon(end))}`;
}

/** "October 2026" */
export function formatMonth(month: string): string {
	return MonthYear.format(utcNoon(`${month}-15`));
}

export function addDays(date: EventDate, days: number): EventDate {
	const d = utcNoon(date);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Whole days from `from` until `until` (negative if `until` is earlier) */
export function daysBetween(from: EventDate, until: EventDate): number {
	return Math.round((utcNoon(until).getTime() - utcNoon(from).getTime()) / (24 * 60 * 60 * 1000));
}

////// The /events page //////

/** The season /events opens on: the earliest with any of our events still to come */
export function defaultSeason(snapshot: Pick<FrcEventsSnapshot, "events" | "seasons">, today: EventDate): number {
	const upcoming = snapshot.events.filter(event => event.end >= today).map(event => event.season);
	if (upcoming.length) return Math.min(...upcoming);

	const year = Number(today.slice(0, 4));
	if (snapshot.seasons.includes(year) || !snapshot.seasons.length) return year;
	return Math.max(...snapshot.seasons);
}

export type ScheduleRow =
	| { kind: "week"; key: string; week: number; start: EventDate; end: EventDate; events: FrcEvent[] }
	| { kind: "championship"; key: string; start: EventDate; end: EventDate; events: FrcEvent[] }
	| { kind: "month"; key: string; month: string; start: EventDate; end: EventDate; events: FrcEvent[] };

/**
 * A season laid out for /events: a row for every competition week (empty ones included, so it
 * reads like a calendar), the Championship, and any other events grouped by month, in date order.
 */
export function seasonSchedule(snapshot: Pick<FrcEventsSnapshot, "events" | "weeks">, season: number): ScheduleRow[] {
	const events = snapshot.events.filter(event => event.season === season);

	const weeks = new Map<number, Extract<ScheduleRow, { kind: "week" }>>();
	for (const week of snapshot.weeks) {
		if (week.season !== season) continue;
		weeks.set(week.week, { kind: "week", key: `week-${week.week}`, ...week, events: [] });
	}

	let championship: Extract<ScheduleRow, { kind: "championship" }> | undefined;
	const months = new Map<string, Extract<ScheduleRow, { kind: "month" }>>();

	for (const event of events) {
		let row: ScheduleRow;
		if (event.week !== null) {
			const existing = weeks.get(event.week);
			row = existing ?? {
				kind: "week",
				key: `week-${event.week}`,
				week: event.week,
				start: event.start,
				end: event.end,
				events: [],
			};
			weeks.set(event.week, row);
		} else if (ChampionshipEventTypes.has(event.type)) {
			championship ??= { kind: "championship", key: "championship", start: event.start, end: event.end, events: [] };
			row = championship;
		} else {
			const month = event.start.slice(0, 7);
			const existing = months.get(month);
			row = existing ?? { kind: "month", key: `month-${month}`, month, start: event.start, end: event.end, events: [] };
			months.set(month, row);
		}

		row.events.push(event);
		if (event.start < row.start) row.start = event.start;
		if (event.end > row.end) row.end = event.end;
	}

	const rows: ScheduleRow[] = [...weeks.values(), ...months.values()];
	if (championship) rows.push(championship);

	for (const row of rows) row.events.sort(compareEvents);
	return rows.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

////// Team prioritization (#8) //////

/**
 * Each of our teams' events overlapping `from`..`until` (inclusive), in date order. Teams with
 * none are absent.
 */
export function eventsByTeam(events: readonly FrcEvent[], from: EventDate, until: EventDate): Map<Team, FrcEvent[]> {
	const byTeam = new Map<Team, FrcEvent[]>();

	for (const event of [...events].sort(compareEvents)) {
		if (event.end < from || event.start > until) continue;
		for (const team of event.teams) {
			const list = byTeam.get(team) ?? [];
			list.push(event);
			byTeam.set(team, list);
		}
	}

	return byTeam;
}
