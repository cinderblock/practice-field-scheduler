import { describe, expect, it } from "vitest";
import {
	activeBlackouts,
	blackoutCoversDate,
	blackoutCoversSlot,
	blackoutDayCount,
	blackoutEndDate,
	blackoutsForDate,
	eachBlackoutDate,
	findBlackoutForSlot,
	findWholeDayBlackout,
	formatBlackoutDates,
	InvalidBlackoutRangeError,
	isBlackoutRange,
	normalizeBlackoutRange,
} from "~/server/util/blackout";
import type { Blackout } from "~/types";

function makeBlackout(partial: Partial<Blackout> & Pick<Blackout, "date">): Blackout {
	return {
		id: partial.date,
		created: new Date("2026-01-01T00:00:00Z"),
		userId: "user-1",
		...partial,
	};
}

describe("blackoutEndDate / isBlackoutRange", () => {
	it("treats a blackout with no endDate as a single day", () => {
		const b = makeBlackout({ date: "2026-03-03" });
		expect(blackoutEndDate(b)).toBe("2026-03-03");
		expect(isBlackoutRange(b)).toBe(false);
	});

	it("reports the last day of a range", () => {
		const b = makeBlackout({ date: "2026-03-03", endDate: "2026-03-07" });
		expect(blackoutEndDate(b)).toBe("2026-03-07");
		expect(isBlackoutRange(b)).toBe(true);
	});

	it("does not treat an endDate equal to the start as a range", () => {
		const b = makeBlackout({ date: "2026-03-03", endDate: "2026-03-03" });
		expect(isBlackoutRange(b)).toBe(false);
	});
});

describe("blackoutDayCount", () => {
	it("counts a single day as 1", () => {
		expect(blackoutDayCount(makeBlackout({ date: "2026-03-03" }))).toBe(1);
	});

	it("counts both ends of a range", () => {
		expect(blackoutDayCount(makeBlackout({ date: "2026-03-03", endDate: "2026-03-07" }))).toBe(5);
	});

	it("counts across a month boundary", () => {
		expect(blackoutDayCount(makeBlackout({ date: "2026-01-30", endDate: "2026-02-02" }))).toBe(4);
	});

	it("is not thrown off by a daylight-saving transition", () => {
		// US DST starts 2026-03-08; naive local-time arithmetic loses an hour here
		expect(blackoutDayCount(makeBlackout({ date: "2026-03-07", endDate: "2026-03-09" }))).toBe(3);
	});

	it("counts a leap day", () => {
		expect(blackoutDayCount(makeBlackout({ date: "2024-02-28", endDate: "2024-03-01" }))).toBe(3);
	});
});

describe("eachBlackoutDate", () => {
	it("yields just the one day for a single-day blackout", () => {
		expect(eachBlackoutDate(makeBlackout({ date: "2026-03-03" }))).toEqual(["2026-03-03"]);
	});

	it("yields every day of a range in order, inclusive of both ends", () => {
		expect(eachBlackoutDate(makeBlackout({ date: "2026-03-03", endDate: "2026-03-06" }))).toEqual([
			"2026-03-03",
			"2026-03-04",
			"2026-03-05",
			"2026-03-06",
		]);
	});

	it("crosses a month boundary", () => {
		expect(eachBlackoutDate(makeBlackout({ date: "2026-01-30", endDate: "2026-02-01" }))).toEqual([
			"2026-01-30",
			"2026-01-31",
			"2026-02-01",
		]);
	});

	it("crosses a daylight-saving transition without skipping or repeating a day", () => {
		expect(eachBlackoutDate(makeBlackout({ date: "2026-03-07", endDate: "2026-03-09" }))).toEqual([
			"2026-03-07",
			"2026-03-08",
			"2026-03-09",
		]);
	});
});

describe("blackoutCoversDate", () => {
	const range = makeBlackout({ date: "2026-03-03", endDate: "2026-03-06" });

	it("covers both endpoints", () => {
		expect(blackoutCoversDate(range, "2026-03-03")).toBe(true);
		expect(blackoutCoversDate(range, "2026-03-06")).toBe(true);
	});

	it("covers days inside the range", () => {
		expect(blackoutCoversDate(range, "2026-03-05")).toBe(true);
	});

	it("does not cover days outside the range", () => {
		expect(blackoutCoversDate(range, "2026-03-02")).toBe(false);
		expect(blackoutCoversDate(range, "2026-03-07")).toBe(false);
	});

	it("covers only its own day when there is no range", () => {
		const single = makeBlackout({ date: "2026-03-03" });
		expect(blackoutCoversDate(single, "2026-03-03")).toBe(true);
		expect(blackoutCoversDate(single, "2026-03-04")).toBe(false);
	});
});

describe("blackoutCoversSlot", () => {
	it("covers every slot when no slot is set", () => {
		const allDay = makeBlackout({ date: "2026-03-03" });
		expect(blackoutCoversSlot(allDay, "2026-03-03", "10:00am")).toBe(true);
		expect(blackoutCoversSlot(allDay, "2026-03-03", "04:00pm")).toBe(true);
	});

	it("covers only the named slot when one is set", () => {
		const slotOnly = makeBlackout({ date: "2026-03-03", slot: "10:00am" });
		expect(blackoutCoversSlot(slotOnly, "2026-03-03", "10:00am")).toBe(true);
		expect(blackoutCoversSlot(slotOnly, "2026-03-03", "04:00pm")).toBe(false);
	});

	it("applies the slot restriction on every day of a range", () => {
		const b = makeBlackout({ date: "2026-03-03", endDate: "2026-03-06", slot: "10:00am" });
		expect(blackoutCoversSlot(b, "2026-03-05", "10:00am")).toBe(true);
		expect(blackoutCoversSlot(b, "2026-03-05", "04:00pm")).toBe(false);
		expect(blackoutCoversSlot(b, "2026-03-07", "10:00am")).toBe(false);
	});
});

describe("findBlackoutForSlot", () => {
	const blackouts = [
		makeBlackout({ id: "deleted", date: "2026-03-03", deleted: new Date("2026-02-01T00:00:00Z") }),
		makeBlackout({ id: "slot", date: "2026-03-04", slot: "10:00am", reason: "Resurfacing" }),
		makeBlackout({ id: "range", date: "2026-04-01", endDate: "2026-04-03" }),
	];

	it("ignores removed blackouts", () => {
		expect(findBlackoutForSlot(blackouts, "2026-03-03", "10:00am")).toBeUndefined();
	});

	it("returns the covering blackout so the reason can be shown", () => {
		expect(findBlackoutForSlot(blackouts, "2026-03-04", "10:00am")?.reason).toBe("Resurfacing");
	});

	it("returns undefined for a slot the blackout does not cover", () => {
		expect(findBlackoutForSlot(blackouts, "2026-03-04", "04:00pm")).toBeUndefined();
	});

	it("matches any slot inside an all-day range", () => {
		expect(findBlackoutForSlot(blackouts, "2026-04-02", "04:00pm")?.id).toBe("range");
	});
});

describe("blackoutsForDate / findWholeDayBlackout / activeBlackouts", () => {
	const blackouts = [
		makeBlackout({ id: "slot", date: "2026-05-01", slot: "10:00am" }),
		makeBlackout({ id: "allDay", date: "2026-05-02", endDate: "2026-05-04" }),
		makeBlackout({ id: "gone", date: "2026-05-02", deleted: new Date("2026-04-01T00:00:00Z") }),
	];

	it("lists every active blackout touching a day", () => {
		expect(blackoutsForDate(blackouts, "2026-05-02").map(b => b.id)).toEqual(["allDay"]);
	});

	it("only reports a whole day closed for a blackout with no slot", () => {
		expect(findWholeDayBlackout(blackouts, "2026-05-01")).toBeUndefined();
		expect(findWholeDayBlackout(blackouts, "2026-05-03")?.id).toBe("allDay");
	});

	it("filters out removed blackouts", () => {
		expect(activeBlackouts(blackouts).map(b => b.id)).toEqual(["slot", "allDay"]);
	});
});

describe("normalizeBlackoutRange", () => {
	it("drops an endDate equal to the start date", () => {
		const result = normalizeBlackoutRange({ date: "2026-03-03", endDate: "2026-03-03" });
		expect(result.endDate).toBeUndefined();
	});

	it("keeps a genuine range", () => {
		const result = normalizeBlackoutRange({ date: "2026-03-03", endDate: "2026-03-07" });
		expect(result.endDate).toBe("2026-03-07");
	});

	it("rejects a range that runs backwards", () => {
		expect(() => normalizeBlackoutRange({ date: "2026-03-07", endDate: "2026-03-03" })).toThrow(
			InvalidBlackoutRangeError,
		);
	});

	it("trims a reason and drops a blank one", () => {
		expect(normalizeBlackoutRange({ date: "2026-03-03", reason: "  Resurfacing  " }).reason).toBe("Resurfacing");
		expect(normalizeBlackoutRange({ date: "2026-03-03", reason: "   " }).reason).toBeUndefined();
	});
});

describe("formatBlackoutDates", () => {
	it("spells out a single day with its weekday", () => {
		expect(formatBlackoutDates(makeBlackout({ date: "2026-03-03" }))).toBe("Tuesday, March 3, 2026");
	});

	it("renders a range with one year at the end", () => {
		expect(formatBlackoutDates(makeBlackout({ date: "2026-03-03", endDate: "2026-03-07" }))).toBe(
			"March 3 – March 7, 2026",
		);
	});

	it("keeps both years when a range crosses new year", () => {
		expect(formatBlackoutDates(makeBlackout({ date: "2025-12-30", endDate: "2026-01-02" }))).toBe(
			"December 30, 2025 – January 2, 2026",
		);
	});
});
