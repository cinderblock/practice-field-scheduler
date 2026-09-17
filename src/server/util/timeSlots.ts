import { TZDateMini } from "@date-fns/tz";
import type { EventDate, TimeSlot } from "~/types";

/*
 * These helpers run in the browser as well as on the server, so they take the
 * deployment's slot borders and time zone as arguments rather than reading
 * `~/env`: those settings are server-only now. Server callers pass
 * `env.TIME_SLOT_BORDERS` / `env.TIME_ZONE`; client components take them from
 * `useAppConfig()`.
 */

/**
 * Convert an absolute hour of the day to the canonical slot string stored on reservations and
 * blackouts.
 *
 * NOTE: fractional hours are not handled here, so a fractional entry in the
 * slot borders produces a malformed slot string. That behaviour predates this
 * helper being extracted and is preserved deliberately: changing the format would orphan every
 * reservation already persisted under the old one.
 */
export function hourToTimeSlot(hour: number, minute = 0): TimeSlot {
	const am_pm = hour < 12 ? "am" : "pm";
	if (hour > 12) hour -= 12;
	return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}${am_pm}`;
}

export type TimeSlotDefinition = {
	slot: TimeSlot;
	/** Absolute hour the slot starts at, 0-24 */
	startHour: number;
	/** Absolute hour the slot ends at, 0-24 */
	endHour: number;
};

/**
 * The configured time slots for a day, derived from the deployment's slot borders.
 *
 * Borders are hours relative to noon, so a border of -2 is 10am. Each adjacent pair of borders
 * defines one slot, which is why N borders produce N-1 slots.
 */
export function getTimeSlots(borders: readonly number[]): TimeSlotDefinition[] {
	return borders.slice(0, -1).map((start, index) => {
		const end = borders[index + 1];
		if (start === undefined || end === undefined) throw new Error("TimeSlotBorders is empty");

		const startHour = 12 + start;
		const endHour = 12 + end;

		return { slot: hourToTimeSlot(startHour), startHour, endHour };
	});
}

/** A slot border for people to read, e.g. "10am", "4:30pm", "12pm" */
export function formatHour(hour: number): string {
	const totalMinutes = Math.round(hour * 60);
	const hours24 = Math.floor(totalMinutes / 60) % 24;
	const minutes = totalMinutes % 60;
	const hours12 = hours24 % 12 || 12;
	return `${hours12}${minutes ? `:${minutes.toString().padStart(2, "0")}` : ""}${hours24 < 12 ? "am" : "pm"}`;
}

/**
 * The instant a (possibly fractional) hour of a calendar day occurs at the site, regardless of the
 * time zone the code is running in.
 */
export function createDateFromDateStringHour(date: EventDate, hour: number, timeZone: string): Date {
	const [year, month, day] = date.split("-").map(Number);

	if (year === undefined || month === undefined || day === undefined) throw new Error("Invalid date");

	// Handle fractional hours
	const wholeHours = Math.floor(hour);
	const minutes = Math.round((hour - wholeHours) * 60);

	const wholeMinutes = Math.floor(minutes);
	const seconds = Math.round((minutes - wholeMinutes) * 60);

	const tzDate = new TZDateMini(year, month - 1, day, wholeHours, wholeMinutes, seconds, timeZone);

	return new Date(tzDate.getTime());
}

export type SlotWindow = {
	/** Epoch milliseconds */
	start: number;
	/** Epoch milliseconds */
	end: number;
};

/** When each of the day's slots starts and ends, in slot order */
export function getSlotWindows(date: EventDate, borders: readonly number[], timeZone: string): SlotWindow[] {
	return getTimeSlots(borders).map(({ startHour, endHour }) => ({
		start: createDateFromDateStringHour(date, startHour, timeZone).getTime(),
		end: createDateFromDateStringHour(date, endHour, timeZone).getTime(),
	}));
}
