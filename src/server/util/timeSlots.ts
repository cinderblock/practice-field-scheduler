import { env } from "~/env";
import type { TimeSlot } from "~/types";

/**
 * Convert an absolute hour of the day to the canonical slot string stored on reservations and
 * blackouts.
 *
 * NOTE: fractional hours are not handled here, so a fractional entry in
 * NEXT_PUBLIC_TIME_SLOT_BORDERS produces a malformed slot string. That behaviour predates this
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
 * The configured time slots for a day, derived from NEXT_PUBLIC_TIME_SLOT_BORDERS.
 *
 * Borders are hours relative to noon, so a border of -2 is 10am. Each adjacent pair of borders
 * defines one slot, which is why N borders produce N-1 slots.
 */
export function getTimeSlots(): TimeSlotDefinition[] {
	const borders = env.NEXT_PUBLIC_TIME_SLOT_BORDERS;

	return borders.slice(0, -1).map((start, index) => {
		const end = borders[index + 1];
		if (start === undefined || end === undefined) throw new Error("TimeSlotBorders is empty");

		const startHour = 12 + start;
		const endHour = 12 + end;

		return { slot: hourToTimeSlot(startHour), startHour, endHour };
	});
}
