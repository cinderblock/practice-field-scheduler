/**
 * Pure helpers for reasoning about blackouts.
 *
 * A blackout covers the inclusive date range `date`..`endDate` (`endDate` omitted means a single
 * day) and, optionally, a single `slot` within each of those days. Nothing here touches storage or
 * the environment, so it is safe to use from both the server and client components.
 *
 * Dates are `YYYY-MM-DD` strings, which sort lexicographically in chronological order. Coverage
 * checks rely on that rather than constructing `Date` objects, so they can't be skewed by the
 * running process's timezone.
 */

import type { Blackout, EventDate, TimeSlot } from "~/types";

/** The last day a blackout covers. Same as the first day for a single-day blackout. */
export function blackoutEndDate(blackout: Pick<Blackout, "date" | "endDate">): EventDate {
	return blackout.endDate ?? blackout.date;
}

/** True if the blackout spans more than one day. */
export function isBlackoutRange(blackout: Pick<Blackout, "date" | "endDate">): boolean {
	return blackoutEndDate(blackout) !== blackout.date;
}

function toUtcMillis(date: EventDate): number {
	const [year, month, day] = date.split("-").map(Number);
	if (year === undefined || month === undefined || day === undefined) throw new Error(`Invalid date: ${date}`);
	return Date.UTC(year, month - 1, day);
}

function fromUtcMillis(millis: number): EventDate {
	return new Date(millis).toISOString().slice(0, 10);
}

const MillisPerDay = 24 * 60 * 60 * 1000;

/** Number of days a blackout covers, inclusive of both ends. Always at least 1. */
export function blackoutDayCount(blackout: Pick<Blackout, "date" | "endDate">): number {
	const days = (toUtcMillis(blackoutEndDate(blackout)) - toUtcMillis(blackout.date)) / MillisPerDay + 1;
	return Math.max(1, Math.round(days));
}

/** Every date a blackout covers, in chronological order. */
export function eachBlackoutDate(blackout: Pick<Blackout, "date" | "endDate">): EventDate[] {
	const start = toUtcMillis(blackout.date);
	return Array.from({ length: blackoutDayCount(blackout) }, (_, i) => fromUtcMillis(start + i * MillisPerDay));
}

/** True if `date` falls within the blackout's date range, ignoring which slot(s) it covers. */
export function blackoutCoversDate(blackout: Pick<Blackout, "date" | "endDate">, date: EventDate): boolean {
	return date >= blackout.date && date <= blackoutEndDate(blackout);
}

/**
 * True if the blackout covers a specific slot on a specific day.
 *
 * A blackout with no `slot` covers every slot of every day in its range.
 */
export function blackoutCoversSlot(
	blackout: Pick<Blackout, "date" | "endDate" | "slot">,
	date: EventDate,
	slot: TimeSlot,
): boolean {
	if (!blackoutCoversDate(blackout, date)) return false;
	return blackout.slot === undefined || blackout.slot === slot;
}

/** Blackouts that have not been removed. */
export function activeBlackouts<T extends Pick<Blackout, "deleted">>(blackouts: readonly T[]): T[] {
	return blackouts.filter(b => !b.deleted);
}

/**
 * The first active blackout covering the given slot, or undefined if the slot is bookable.
 *
 * Returns the blackout itself rather than a boolean so callers can show the reason.
 */
export function findBlackoutForSlot<T extends Pick<Blackout, "date" | "endDate" | "slot" | "deleted">>(
	blackouts: readonly T[],
	date: EventDate,
	slot: TimeSlot,
): T | undefined {
	return blackouts.find(b => !b.deleted && blackoutCoversSlot(b, date, slot));
}

/** All active blackouts that cover any part of the given day. */
export function blackoutsForDate<T extends Pick<Blackout, "date" | "endDate" | "deleted">>(
	blackouts: readonly T[],
	date: EventDate,
): T[] {
	return blackouts.filter(b => !b.deleted && blackoutCoversDate(b, date));
}

/**
 * The first active blackout that closes the whole of the given day, or undefined if the day has at
 * most a slot or two closed.
 *
 * Returns the blackout itself so callers can show the reason once for the day.
 */
export function findWholeDayBlackout<T extends Pick<Blackout, "date" | "endDate" | "slot" | "deleted">>(
	blackouts: readonly T[],
	date: EventDate,
): T | undefined {
	return blackouts.find(b => !b.deleted && b.slot === undefined && blackoutCoversDate(b, date));
}

export class InvalidBlackoutRangeError extends Error {
	constructor(date: EventDate, endDate: EventDate) {
		super(`Blackout end date (${endDate}) must not be before its start date (${date})`);
		this.name = "InvalidBlackoutRangeError";
	}
}

/**
 * Put a blackout's range into canonical form.
 *
 * An `endDate` equal to the start date is dropped so that single-day blackouts have exactly one
 * representation, and an empty `reason` is dropped so it doesn't render as a blank line.
 *
 * @throws {InvalidBlackoutRangeError} if the range runs backwards.
 */
export function normalizeBlackoutRange<T extends Pick<Blackout, "date" | "endDate" | "reason">>(blackout: T): T {
	const { date, endDate } = blackout;

	if (endDate !== undefined && endDate < date) throw new InvalidBlackoutRangeError(date, endDate);

	const reason = blackout.reason?.trim();

	return {
		...blackout,
		endDate: endDate === undefined || endDate === date ? undefined : endDate,
		reason: reason ? reason : undefined,
	};
}

/**
 * Human-readable date range, e.g. "Tuesday, March 3, 2026" or "March 3 – March 7, 2026".
 *
 * The locale is pinned so server-rendered and client-rendered output agree.
 */
export function formatBlackoutDates(blackout: Pick<Blackout, "date" | "endDate">): string {
	const end = blackoutEndDate(blackout);

	const format = (date: EventDate, options: Intl.DateTimeFormatOptions) =>
		// Noon avoids the date shifting under timezones west of UTC
		new Date(`${date}T12:00:00`).toLocaleDateString("en-US", options);

	if (end === blackout.date) {
		return format(blackout.date, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
	}

	const sameYear = blackout.date.slice(0, 4) === end.slice(0, 4);

	return `${format(blackout.date, { month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} – ${format(
		end,
		{ month: "long", day: "numeric", year: "numeric" },
	)}`;
}
