import type { Reservation, TeamFull } from "~/types";

/** The largest team number we accept. The avatar route holds to the same limit. */
export const MAX_TEAM_NUMBER = 100_000;

/** A reservation's note is a few words on a calendar pill. */
export const RESERVATION_NOTES_MAX = 100;

/**
 * How many lines in a slot get the field. Every line takes a place: a team's own, a
 * guest's, an extra robot's. Lines past this are waitlisted. Nobody is refused.
 */
export const SLOT_CAPACITY = 4;

/** A positive whole number written plainly: digits only, no leading zero. */
export function isValidTeamNumber(team: TeamFull): boolean {
	const text = String(team);
	return /^[1-9]\d*$/.test(text) && Number(text) <= MAX_TEAM_NUMBER;
}

/** Where a line stands in its slot. `place` counts from 1. */
export type SlotStanding = { place: number; waitlisted: boolean };

type Ordered = Pick<Reservation, "id" | "priority" | "created" | "abandoned">;

/**
 * One slot's live lines in field order: priority lines first, then the rest, each in
 * booking order. A late priority line can push an earlier ordinary one below
 * {@link SLOT_CAPACITY}. Abandoned lines are left out.
 *
 * The order is never stored. It's worked out from the lines each time, so a
 * cancellation moves the waitlist up by itself.
 */
export function orderSlot<T extends Ordered>(lines: readonly T[]): T[] {
	return lines
		.filter(r => !r.abandoned)
		.map((r, index) => ({ r, index }))
		.sort(
			(a, b) =>
				Number(Boolean(b.r.priority)) - Number(Boolean(a.r.priority)) ||
				new Date(a.r.created).getTime() - new Date(b.r.created).getTime() ||
				a.index - b.index,
		)
		.map(({ r }) => r);
}

/** Each live line's place in one slot, keyed by reservation id. */
export function slotStandings(lines: readonly Ordered[]): Map<string, SlotStanding> {
	return new Map(orderSlot(lines).map((r, i) => [r.id, { place: i + 1, waitlisted: i + 1 > SLOT_CAPACITY }] as const));
}

/**
 * Whether a priority line actually holds a place. A priority line that landed on the
 * waitlist (because enough other priority lines got there first) doesn't. This is the
 * hook for #10's limit on priority lines. It's live: it changes as others book and cancel.
 */
export function gotPriorityPlace(line: Pick<Reservation, "priority">, standing: SlotStanding | undefined): boolean {
	return Boolean(line.priority) && standing !== undefined && !standing.waitlisted;
}

/** Lines whose waitlisted state differs between two standings of the same slot. */
export function standingChanges(
	before: ReadonlyMap<string, SlotStanding>,
	after: ReadonlyMap<string, SlotStanding>,
): { bumped: string[]; promoted: string[] } {
	const bumped: string[] = [];
	const promoted: string[] = [];
	for (const [id, now] of after) {
		const was = before.get(id);
		if (!was) continue;
		if (!was.waitlisted && now.waitlisted) bumped.push(id);
		if (was.waitlisted && !now.waitlisted) promoted.push(id);
	}
	return { bumped, promoted };
}
