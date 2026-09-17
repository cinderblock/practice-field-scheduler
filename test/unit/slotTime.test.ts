import { afterEach, describe, expect, it, vi } from "vitest";
import { addFieldDays, fieldToday, getReservationWindow } from "~/server/util/slotTime";

// .env.test sets:
//   TIME_SLOT_BORDERS="-2, 4, 7, 10"  → absolute hours [10, 16, 19, 22]
//   TIME_ZONE="America/Los_Angeles"
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

describe("fieldToday", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	// Only `Date` is faked: the rest of the timers stay real, so nothing hangs.
	function at(iso: string) {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(iso));
	}

	it("reports the field's calendar day, not the server's", () => {
		// 22:30 in Los Angeles on the 17th; UTC has already rolled over to the 18th.
		at("2026-09-18T05:30:00Z");
		expect(fieldToday()).toBe("2026-09-17");
	});

	it("rolls over at midnight in the field's zone", () => {
		at("2026-09-18T06:59:00Z"); // 23:59 PDT
		expect(fieldToday()).toBe("2026-09-17");
		at("2026-09-18T07:01:00Z"); // 00:01 PDT
		expect(fieldToday()).toBe("2026-09-18");
	});

	it("pads single-digit months and days so dates compare as strings", () => {
		at("2026-01-05T18:00:00Z");
		expect(fieldToday()).toBe("2026-01-05");
	});
});

describe("addFieldDays", () => {
	it("counts whole calendar days", () => {
		expect(addFieldDays("2026-09-17", 7)).toBe("2026-09-24");
		expect(addFieldDays("2026-09-17", 0)).toBe("2026-09-17");
		expect(addFieldDays("2026-09-17", -1)).toBe("2026-09-16");
	});

	it("crosses month and year boundaries", () => {
		expect(addFieldDays("2026-09-30", 1)).toBe("2026-10-01");
		expect(addFieldDays("2026-12-28", 7)).toBe("2027-01-04");
		expect(addFieldDays("2026-03-01", -1)).toBe("2026-02-28");
	});

	it("is unaffected by daylight saving", () => {
		// 2026-11-01 is the US fall-back day: a 25-hour day locally, still one
		// calendar day here.
		expect(addFieldDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(addFieldDays("2026-10-30", 7)).toBe("2026-11-06");
		// 2026-03-08 is the spring-forward day, 23 hours locally.
		expect(addFieldDays("2026-03-07", 1)).toBe("2026-03-08");
	});

	it("returns null on a malformed date", () => {
		expect(addFieldDays("not-a-date", 1)).toBeNull();
	});
});
