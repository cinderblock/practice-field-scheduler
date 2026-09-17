import { describe, expect, it } from "vitest";
import { getReservationWindow } from "~/server/util/slotTime";

// .env.test sets:
//   NEXT_PUBLIC_TIME_SLOT_BORDERS="-2, 4, 7, 10"  → absolute hours [10, 16, 19, 22]
//   NEXT_PUBLIC_TIME_ZONE="America/Los_Angeles"
//
// The four slots in this config are 10am, 4pm, 7pm, 10pm. 10pm has no
// configured next border so it falls back to start + 3h.

describe("getReservationWindow", () => {
	it("returns null on malformed slot", () => {
		expect(getReservationWindow("2026-05-23", "not-a-slot")).toBeNull();
		expect(getReservationWindow("2026-05-23", "9:00xm")).toBeNull();
	});

	it("returns null on malformed date", () => {
		expect(getReservationWindow("not-a-date", "10:00am")).toBeNull();
	});

	it("uses the next configured border for the end", () => {
		const win = getReservationWindow("2026-05-23", "10:00am");
		expect(win).not.toBeNull();
		if (!win) return;
		// 10am LA on 2026-05-23 is during PDT (UTC-7), so 17:00 UTC.
		expect(win.start.toISOString()).toBe("2026-05-23T17:00:00.000Z");
		// Ends at next border (16 = 4pm LA = 23:00 UTC in PDT).
		expect(win.end.toISOString()).toBe("2026-05-23T23:00:00.000Z");
	});

	it("falls back to start + 3h when the slot has no next border", () => {
		const win = getReservationWindow("2026-05-23", "10:00pm");
		expect(win).not.toBeNull();
		if (!win) return;
		// 10pm LA PDT = 05:00 UTC next day.
		expect(win.start.toISOString()).toBe("2026-05-24T05:00:00.000Z");
		// Fallback: +3 hours.
		expect(win.end.toISOString()).toBe("2026-05-24T08:00:00.000Z");
	});

	it("falls back to start + 3h when the slot does not match any border", () => {
		const win = getReservationWindow("2026-05-23", "9:00am");
		expect(win).not.toBeNull();
		if (!win) return;
		// 9am LA PDT = 16:00 UTC.
		expect(win.start.toISOString()).toBe("2026-05-23T16:00:00.000Z");
		// Fallback: +3 hours.
		expect(win.end.toISOString()).toBe("2026-05-23T19:00:00.000Z");
	});

	it("respects standard time (PST, UTC-8) outside DST", () => {
		// Late January is PST.
		const win = getReservationWindow("2026-01-15", "10:00am");
		expect(win).not.toBeNull();
		if (!win) return;
		expect(win.start.toISOString()).toBe("2026-01-15T18:00:00.000Z");
		expect(win.end.toISOString()).toBe("2026-01-16T00:00:00.000Z");
	});
});
