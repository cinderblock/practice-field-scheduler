/**
 * Per-team weekly limits on bookings (#10), on top of #9's priority and waitlist.
 *
 * Weeks run Monday through Sunday at the field, and a line belongs to the week of
 * its slot's date. A line is charged to the team whose access it grants: the host
 * for a guest line, otherwise its own team.
 *
 * - Priority: at most {@link PRIORITY_PER_WEEK} per team per week. A priority line
 *   counts until its day has passed, waitlisted or not. After that it counts only if
 *   it held a place. Over the limit, a priority booking is refused.
 * - Total: the first {@link LINES_PER_WEEK} counted lines a team books in a week are
 *   ordinary. Later ones are booked anyway but sort after everyone else in their
 *   slot, so they get the field only if there's room. Extra-robot lines don't count,
 *   and neither do days before today, so the allowance frees up as the week goes on.
 *
 * Like the slot order, all of this is worked out from the lines each time and never
 * stored.
 */
import { accessTeamFor, sameTeam } from "~/server/access";
import type { EventDate, Reservation, TeamFull } from "~/types";
import { gotPriorityPlace, type SlotStanding, slotStandings } from "./reservation";
import { fieldWeekStart } from "./slotTime";

/** Priority lines a team may hold in one week. */
export const PRIORITY_PER_WEEK = 1;

/** Lines a team may book in one week before later ones sort last. */
export const LINES_PER_WEEK = 7;

/**
 * How many priority lines `team` may hold in the week starting `weekStart`. The same
 * for everyone for now; this is where #8 adds a bonus for teams with an upcoming event.
 */
export function priorityAllowance(_team: TeamFull, _weekStart: EventDate): number {
	return PRIORITY_PER_WEEK;
}

type Line = Pick<
	Reservation,
	"id" | "date" | "slot" | "team" | "host" | "priority" | "extraRobot" | "created" | "abandoned" | "overWeeklyCap"
>;

/** A key that is equal for two teams exactly when `sameTeam` says they're the same. */
function teamKey(team: TeamFull): string {
	const n = typeof team === "string" ? Number.parseInt(team, 10) : team;
	return Number.isFinite(n) ? `#${n}` : `"${String(team).trim()}"`;
}

/** Whether a line uses one of its team's {@link LINES_PER_WEEK}, as of `today`. */
export function countsTowardWeeklyCap(line: Line, today: EventDate): boolean {
	return !line.abandoned && !line.extraRobot && line.date >= today;
}

/** The lines of `lines` in the same booking week as `date`. */
export function linesInWeekOf<T extends Line>(lines: readonly T[], date: EventDate): T[] {
	const week = fieldWeekStart(date);
	return week === null ? [] : lines.filter(l => fieldWeekStart(l.date) === week);
}

/** The ids of the lines past their team's weekly cap, as of `today`. */
export function overWeeklyCap(lines: readonly Line[], today: EventDate): Set<string> {
	const groups = new Map<string, { line: Line; index: number }[]>();
	lines.forEach((line, index) => {
		if (!countsTowardWeeklyCap(line, today)) return;
		const week = fieldWeekStart(line.date);
		if (week === null) return;
		const key = `${week} ${teamKey(accessTeamFor(line))}`;
		groups.set(key, [...(groups.get(key) ?? []), { line, index }]);
	});

	const over = new Set<string>();
	for (const group of groups.values()) {
		// The team's earliest bookings keep their places, priority lines first: booking a
		// priority line pushes the team's newest ordinary line over instead.
		const ranked = group.sort(
			(a, b) =>
				Number(Boolean(b.line.priority)) - Number(Boolean(a.line.priority)) ||
				new Date(a.line.created).getTime() - new Date(b.line.created).getTime() ||
				a.index - b.index,
		);
		for (const { line } of ranked.slice(LINES_PER_WEEK)) if (!line.priority) over.add(line.id);
	}
	return over;
}

/**
 * `lines` with `overWeeklyCap` worked out. Flagged lines are copies; the rest are
 * returned as they are, so nothing stored is ever changed. Pass every line of the
 * weeks involved, since a line's status depends on its team's other lines that week.
 */
export function withWeeklyCap<T extends Line>(lines: readonly T[], today: EventDate): T[] {
	const over = overWeeklyCap(lines, today);
	return lines.map(line => {
		if (over.has(line.id)) return { ...line, overWeeklyCap: true as const };
		if (!line.overWeeklyCap) return line;
		const { overWeeklyCap: _, ...rest } = line;
		return rest as T;
	});
}

/** Every live line's standing in its own slot, keyed by reservation id. */
export function standingsBySlot(lines: readonly Line[]): Map<string, SlotStanding> {
	const bySlot = new Map<string, Line[]>();
	for (const line of lines) {
		const key = `${line.date} ${line.slot}`;
		bySlot.set(key, [...(bySlot.get(key) ?? []), line]);
	}
	return new Map([...bySlot.values()].flatMap(slot => [...slotStandings(slot)]));
}

/** Where a team stands against both limits in the week of `date`. */
export type WeeklyUsage = {
	weekStart: EventDate;
	/** The priority lines using up this week's allowance, earliest first. */
	priorityUsed: Line[];
	priorityAllowance: number;
	/** Lines counted toward {@link LINES_PER_WEEK} (today on). */
	lines: number;
	cap: number;
};

/** `team`'s usage of both limits in the week of `date`, as of `today`. */
export function weeklyUsage(all: readonly Line[], team: TeamFull, date: EventDate, today: EventDate): WeeklyUsage {
	const weekStart = fieldWeekStart(date) ?? date;
	const week = withWeeklyCap(
		linesInWeekOf(all, date).filter(l => !l.abandoned),
		today,
	);
	const standings = standingsBySlot(week);
	const mine = week.filter(l => sameTeam(accessTeamFor(l), team));
	const priorityUsed = mine
		.filter(l => l.priority && (l.date >= today || gotPriorityPlace(l, standings.get(l.id))))
		.sort((a, b) => a.date.localeCompare(b.date) || new Date(a.created).getTime() - new Date(b.created).getTime());
	return {
		weekStart,
		priorityUsed,
		priorityAllowance: priorityAllowance(team, weekStart),
		lines: mine.filter(l => countsTowardWeeklyCap(l, today)).length,
		cap: LINES_PER_WEEK,
	};
}
