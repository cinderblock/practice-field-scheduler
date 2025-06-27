import { describe, expect, it } from "vitest";
import {
	dateToDateString,
	dateToTime,
	dateToTimeSlotString,
	isValidDate,
	isValidTime,
	isValidTimeSlot,
} from "~/server/util/timeUtils";

describe("timeUtils", () => {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const today = `${yyyy}-${mm}-${dd}`;

	it("dateToDateString should format date as YYYY-MM-DD", () => {
		expect(dateToDateString(now)).toBe(today);
	});

	it("dateToTime should format time with am/pm", () => {
		const t = dateToTime(now);
		expect(t).toMatch(/\d{2}:\d{2}(am|pm)/);
	});

	it("dateToTimeSlotString should combine date and time", () => {
		const slot = dateToTimeSlotString(now);
		expect(slot).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}(am|pm)/);
	});

	it("isValidDate accepts today", () => {
		expect(isValidDate(today)).toBe(true);
	});

	it("isValidTime accepts 09:00am", () => {
		expect(isValidTime("09:00am")).toBe(true);
	});

	it("isValidTimeSlot accepts a valid slot", () => {
		expect(isValidTimeSlot(`${today} 09:00am`)).toBe(true);
	});

	it("isValidTime rejects bad input", () => {
		expect(isValidTime("24:61pm")).toBe(false);
	});
});
