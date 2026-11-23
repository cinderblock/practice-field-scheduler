"use client";

import { daysBetween, eventLinks, eventsSpan, formatDateRange } from "~/server/util/frcEvents";
import type { FrcEvent } from "~/types";
import styles from "../index.module.css";
import { useAppConfig } from "./AppConfig";
import { TeamAvatar } from "./TeamAvatar";
import { useInterval } from "./useInterval";

function getToday(timeZone: string): string {
	return new Date().toLocaleDateString("en-CA", { timeZone });
}

function heading(start: string, end: string, today: string): string {
	if (end < today) return "Teams that competed";
	if (start <= today) return "Teams competing now";
	const days = daysBetween(today, start);
	if (days < 7) return "Teams competing this weekend";
	if (days < 14) return "Teams competing next weekend";
	return "Teams competing";
}

/**
 * A break in the calendar before a weekend our teams compete: which teams, at which events, with
 * links to each event on The Blue Alliance and Statbotics.
 */
export function EventBreak({ events }: { events: FrcEvent[] }) {
	const { timeZone } = useAppConfig();
	const today = useInterval(() => getToday(timeZone), 60 * 1000, [timeZone]);
	const span = eventsSpan(events);
	if (!span) return null;

	const title = heading(span.start, span.end, today);

	return (
		<section className={styles.eventBreak} aria-label={`${title}, ${formatDateRange(span.start, span.end)}`}>
			<div className={styles.eventBreakHeader}>
				<h3 className={styles.eventBreakTitle} suppressHydrationWarning>
					{title}
				</h3>
				<span className={styles.eventBreakDates}>{formatDateRange(span.start, span.end, { weekday: true })}</span>
			</div>
			<ul className={styles.eventBreakList}>
				{events.map(event => (
					<EventSummary key={`${event.season}${event.code}`} event={event} />
				))}
			</ul>
		</section>
	);
}

/** One event: its name, dates and place, our teams going, and where to follow it */
export function EventSummary({ event, className }: { event: FrcEvent; className?: string }) {
	const links = eventLinks(event);
	const place = [event.city, event.stateProv].filter(Boolean).join(", ");

	return (
		<li className={`${styles.eventSummary} ${className ?? ""}`}>
			<div className={styles.eventSummaryName}>
				<a href={links.tba} target="_blank" rel="noopener noreferrer">
					{event.name}
				</a>
			</div>
			<div className={styles.eventSummaryDetails}>
				{formatDateRange(event.start, event.end)}
				{place && ` · ${place}`}
			</div>
			<ul className={styles.eventTeams} aria-label="Our teams registered">
				{event.teams.map(team => (
					<li key={team} className={styles.eventTeam}>
						<TeamAvatar teamNumber={team} size={20} />
						{team}
					</li>
				))}
			</ul>
			<div className={styles.eventLinks}>
				<a href={links.tba} target="_blank" rel="noopener noreferrer">
					The Blue Alliance
				</a>
				<a href={links.statbotics} target="_blank" rel="noopener noreferrer">
					Statbotics
				</a>
			</div>
		</li>
	);
}
