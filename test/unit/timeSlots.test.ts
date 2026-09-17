import { describe, expect, it } from "vitest";
import {
	createDateFromDateStringHour,
	formatHour,
	getSlotWindows,
	getTimeSlots,
	hourToTimeSlot,
} from "~/server/util/timeSlots";

describe("hourToTimeSlot", () => {
	it("formats morning hours", () => {
		expect(hourToTimeSlot(10)).toBe("10:00am");
		expect(hourToTimeSlot(9)).toBe("09:00am");
	});

	it("formats afternoon hours in 12-hour form", () => {
		expect(hourToTimeSlot(16)).toBe("04:00pm");
		expect(hourToTimeSlot(19)).toBe("07:00pm");
	});

	it("treats noon as pm without subtracting 12", () => {
		expect(hourToTimeSlot(12)).toBe("12:00pm");
	});

	it("includes minutes when given", () => {
		expect(hourToTimeSlot(13, 30)).toBe("01:30pm");
	});
});

/** The deployment's settings are passed in now, so these tests don't depend on .env.test. */
const Borders = [-2, 4, 7, 10];
const TimeZone = "America/Los_Angeles";

describe("getTimeSlots", () => {
	const slots = getTimeSlots(Borders);

	it("produces one slot per adjacent pair of borders", () => {
		expect(slots).toHaveLength(3);
	});

	it("converts borders (hours relative to noon) into absolute hours", () => {
		expect(slots.map(s => [s.startHour, s.endHour])).toEqual([
			[10, 16],
			[16, 19],
			[19, 22],
		]);
	});

	it("labels each slot with the same string reservations are stored under", () => {
		expect(slots.map(s => s.slot)).toEqual(["10:00am", "04:00pm", "07:00pm"]);
	});

	it("starts each slot where the previous one ended", () => {
		for (const [i, slot] of slots.slice(1).entries()) {
			expect(slot.startHour).toBe(slots[i]?.endHour);
		}
	});
});

describe("formatHour", () => {
	it("formats whole hours in 12-hour form", () => {
		expect(formatHour(10)).toBe("10am");
		expect(formatHour(16)).toBe("4pm");
		expect(formatHour(22)).toBe("10pm");
	});

	it("treats noon and midnight conventionally", () => {
		expect(formatHour(12)).toBe("12pm");
		expect(formatHour(0)).toBe("12am");
		expect(formatHour(24)).toBe("12am");
	});

	it("includes minutes for fractional hours", () => {
		expect(formatHour(9.5)).toBe("9:30am");
		expect(formatHour(13.25)).toBe("1:15pm");
	});
});

describe("createDateFromDateStringHour", () => {
	it("finds the instant an hour occurs at the site", () => {
		expect(createDateFromDateStringHour("2026-09-16", 10, TimeZone).toISOString()).toBe("2026-09-16T17:00:00.000Z");
	});

	it("handles fractional hours", () => {
		expect(createDateFromDateStringHour("2026-09-16", 9.5, TimeZone).toISOString()).toBe("2026-09-16T16:30:00.000Z");
	});

	it("follows daylight saving time", () => {
		// Clocks fall back at 2am on 2026-11-01, so 10am that day is PST
		expect(createDateFromDateStringHour("2026-11-01", 10, TimeZone).toISOString()).toBe("2026-11-01T18:00:00.000Z");
	});
});

describe("getSlotWindows", () => {
	it("gives each slot's start and end as instants", () => {
		expect(getSlotWindows("2026-09-16", Borders, TimeZone)).toEqual([
			{ start: Date.parse("2026-09-16T17:00:00Z"), end: Date.parse("2026-09-16T23:00:00Z") },
			{ start: Date.parse("2026-09-16T23:00:00Z"), end: Date.parse("2026-09-17T02:00:00Z") },
			{ start: Date.parse("2026-09-17T02:00:00Z"), end: Date.parse("2026-09-17T05:00:00Z") },
		]);
	});
});
