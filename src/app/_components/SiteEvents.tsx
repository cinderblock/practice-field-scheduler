"use client";

import { createContext, useContext } from "react";
import type { EventDate, SiteCalendarEvent } from "~/types";
import styles from "../index.module.css";
import { useAppConfig } from "./AppConfig";

/**
 * Events from the site's own calendar (SITE_CALENDAR_ICS_URL), handed down by the reservation
 * calendar so each day can list its own without every layer in between passing them along.
 */
const SiteEventsContext = createContext<readonly SiteCalendarEvent[]>([]);

export function SiteEventsProvider({
	events,
	children,
}: {
	events: readonly SiteCalendarEvent[];
	children: React.ReactNode;
}) {
	return <SiteEventsContext.Provider value={events}>{children}</SiteEventsContext.Provider>;
}

function localDate(ms: number, timeZone: string): EventDate {
	return new Date(ms).toLocaleDateString("en-CA", { timeZone });
}

/** "3pm", "3:30pm" */
function formatTime(ms: number, timeZone: string): string {
	return new Date(ms)
		.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
		.replace(":00", "")
		.replace(/\s?AM$/, "am")
		.replace(/\s?PM$/, "pm");
}

/** When on this date the event happens, or null for an all-day event */
function timeLabel(event: SiteCalendarEvent, date: EventDate, timeZone: string): string | null {
	if (event.allDay) return null;

	const startsToday = localDate(event.start, timeZone) === date;
	// The end is exclusive, so an event ending at midnight ends on the day before
	const endsToday = localDate(Math.max(event.end - 1, event.start), timeZone) === date;
	const start = formatTime(event.start, timeZone);
	const end = formatTime(event.end, timeZone);

	if (startsToday && endsToday) return event.end > event.start ? `${start}–${end}` : start;
	if (startsToday) return `from ${start}`;
	if (endsToday) return `until ${end}`;
	return "all day";
}

/** The site events on one day, or nothing when there are none. Display only. */
export function DaySiteEvents({ date }: { date: EventDate }) {
	const { timeZone } = useAppConfig();
	const events = useContext(SiteEventsContext).filter(event => event.dates.includes(date));

	if (!events.length) return null;

	return (
		<ul className={styles.siteEvents} aria-label="Events at the site">
			{events.map(event => {
				const time = timeLabel(event, date, timeZone);
				return (
					<li key={event.id} className={styles.siteEvent}>
						<span className={styles.siteEventIcon} aria-hidden="true">
							📅
						</span>
						<span className={styles.siteEventTitle}>{event.title}</span>
						{time && <span className={styles.siteEventTime}>{time}</span>}
					</li>
				);
			})}
		</ul>
	);
}
