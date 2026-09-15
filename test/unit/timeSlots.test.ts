import { describe, expect, it } from "vitest";
import { getTimeSlots, hourToTimeSlot } from "~/server/util/timeSlots";

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

describe("getTimeSlots", () => {
	// Driven by NEXT_PUBLIC_TIME_SLOT_BORDERS in .env.test: "-2, 4, 7, 10"
	const slots = getTimeSlots();

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
