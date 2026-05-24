import { TZDateMini } from "@date-fns/tz";
import { env } from "~/env";

export type ReservationWindow = {
	start: Date;
	end: Date;
};

/**
 * Convert a reservation date ("YYYY-MM-DD") and slot ("9:00am", "10:00pm")
 * into the absolute UTC moments that bound the reservation.
 *
 * The slot is interpreted in NEXT_PUBLIC_TIME_ZONE so the result is correct
 * regardless of the server's local timezone. The end is taken from the next
 * entry in NEXT_PUBLIC_TIME_SLOT_BORDERS, falling back to start + 3h when the
 * slot doesn't line up with a configured border (matches the calendar feed).
 *
 * Returns null if the inputs are malformed.
 */
export function getReservationWindow(date: string, slot: string): ReservationWindow | null {
	const slotMatch = slot.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
	if (!slotMatch) return null;

	const minute = Number.parseInt(slotMatch[2] as string, 10);
	let hour = Number.parseInt(slotMatch[1] as string, 10);
	const ampm = (slotMatch[3] as string).toLowerCase();
	if (ampm === "pm" && hour !== 12) hour += 12;
	if (ampm === "am" && hour === 12) hour = 0;

	const dateParts = date.split("-");
	if (dateParts.length !== 3) return null;
	const year = Number.parseInt(dateParts[0] as string, 10);
	const month = Number.parseInt(dateParts[1] as string, 10);
	const day = Number.parseInt(dateParts[2] as string, 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

	const start = toUtc(year, month, day, hour, minute);

	// NEXT_PUBLIC_TIME_SLOT_BORDERS is in hours relative to noon; convert to 24h.
	const borders = env.NEXT_PUBLIC_TIME_SLOT_BORDERS.map(b => b + 12);
	const idx = borders.indexOf(hour);
	let end: Date;
	if (idx !== -1 && idx < borders.length - 1) {
		const nextHour = borders[idx + 1];
		if (nextHour !== undefined) {
			end = toUtc(year, month, day, nextHour, minute);
		} else {
			end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
		}
	} else {
		end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
	}

	return { start, end };
}

function toUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
	return new Date(new TZDateMini(year, month - 1, day, hour, minute, 0, env.NEXT_PUBLIC_TIME_ZONE).getTime());
}
