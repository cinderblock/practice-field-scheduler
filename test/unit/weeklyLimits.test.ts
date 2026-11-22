import { describe, expect, it } from "vitest";
import { orderSlot, SLOT_CAPACITY, slotStandings } from "~/server/util/reservation";
import {
	LINES_PER_WEEK,
	overWeeklyCap,
	PRIORITY_PER_WEEK,
	standingsBySlot,
	weeklyUsage,
	withWeeklyCap,
} from "~/server/util/weeklyLimits";
import type { Reservation } from "~/types";

// Week of Monday 2026-11-23 through Sunday 2026-11-29. "Today" is the Tuesday.
const TODAY = "2026-11-24";
const WEEK = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];

let minute = 0;
/** A line booked one minute after the last one made here. */
function line(id: string, date: string, extra: Partial<Reservation> = {}): Reservation {
	minute += 1;
	return {
		id,
		date,
		slot: "04:00pm",
		team: 1234,
		priority: false,
		created: new Date(Date.UTC(2026, 10, 20, 0, minute)),
		userId: "u",
		...extra,
	};
}

/** `count` ordinary lines for team 1234 on the upcoming days of the week, in booking order. */
function bookings(count: number, extra: Partial<Reservation> = {}): Reservation[] {
	const upcoming = WEEK.filter(d => d >= TODAY);
	const slots = ["10:00am", "04:00pm", "07:00pm"];
	return Array.from({ length: count }, (_, i) =>
		line(`l${i + 1}`, upcoming[i % upcoming.length] as string, {
			slot: slots[Math.floor(i / upcoming.length)] as string,
			...extra,
		}),
	);
}

describe("the weekly booking cap", () => {
	it("keeps a team's first bookings of the week ordinary, and puts the rest past the cap", () => {
		const lines = bookings(LINES_PER_WEEK + 2);
		expect([...overWeeklyCap(lines, TODAY)]).toEqual([`l${LINES_PER_WEEK + 1}`, `l${LINES_PER_WEEK + 2}`]);
	});

	it("counts priority lines first, so a late one pushes the team's newest ordinary line past the cap", () => {
		const lines = [...bookings(LINES_PER_WEEK), line("p", "2026-11-28", { priority: true, slot: "07:00pm" })];
		expect([...overWeeklyCap(lines, TODAY)]).toEqual([`l${LINES_PER_WEEK}`]);
	});

	it("doesn't count extra robots, cancelled lines or days before today", () => {
		const lines = [
			line("past", "2026-11-23"),
			line("extra", "2026-11-25", { extraRobot: true }),
			line("gone", "2026-11-25", { slot: "10:00am", abandoned: new Date() }),
			...bookings(LINES_PER_WEEK),
		];
		expect(overWeeklyCap(lines, TODAY).size).toBe(0);
	});

	it("charges a guest line to its host", () => {
		const lines = [
			...bookings(LINES_PER_WEEK),
			line("guest", "2026-11-29", { team: 9999, host: 1234, slot: "10:00am" }),
		];
		expect([...overWeeklyCap(lines, TODAY)]).toEqual(["guest"]);
	});

	it("matches teams the way sameTeam does", () => {
		const lines = [...bookings(LINES_PER_WEEK), line("string", "2026-11-29", { team: "1234", slot: "10:00am" })];
		expect([...overWeeklyCap(lines, TODAY)]).toEqual(["string"]);
	});

	it("counts each week and each team on its own", () => {
		const lines = [
			...bookings(LINES_PER_WEEK),
			line("nextWeek", "2026-11-30"),
			line("otherTeam", "2026-11-29", { team: 5678 }),
		];
		expect(overWeeklyCap(lines, TODAY).size).toBe(0);
	});

	it("flags only copies, and clears a stale flag", () => {
		const lines = bookings(LINES_PER_WEEK + 1);
		const flagged = withWeeklyCap(lines, TODAY);
		expect(flagged.at(-1)?.overWeeklyCap).toBe(true);
		expect(lines.some(l => l.overWeeklyCap)).toBe(false);

		const stale = { ...(lines[0] as Reservation), overWeeklyCap: true as const };
		expect(withWeeklyCap([stale], TODAY)[0]?.overWeeklyCap).toBeUndefined();
	});

	it("sorts a line past the cap after the slot's later ordinary lines, so it waits when the slot is full", () => {
		const over = { ...line("over", "2026-11-26"), overWeeklyCap: true as const };
		const others = Array.from({ length: SLOT_CAPACITY }, (_, i) => line(`o${i}`, "2026-11-26", { team: 2000 + i }));
		const ordered = orderSlot([over, ...others]);
		expect(ordered.map(l => l.id)).toEqual([...others.map(l => l.id), "over"]);
		expect(slotStandings(ordered).get("over")).toEqual({ place: SLOT_CAPACITY + 1, waitlisted: true });

		// With room in the slot it still gets the field
		expect(slotStandings([over, ...others.slice(1)]).get("over")?.waitlisted).toBe(false);
	});

	it("works out standings slot by slot", () => {
		const lines = [line("a", "2026-11-26"), line("b", "2026-11-26", { slot: "10:00am" }), line("c", "2026-11-26")];
		const standings = standingsBySlot(lines);
		expect(standings.get("a")?.place).toBe(1);
		expect(standings.get("b")?.place).toBe(1);
		expect(standings.get("c")?.place).toBe(2);
	});
});

describe("weekly priority usage", () => {
	/** A slot already full of other teams' priority lines, so a priority line there is waitlisted. */
	function fullOfPriority(date: string): Reservation[] {
		return Array.from({ length: SLOT_CAPACITY }, (_, i) =>
			line(`full-${date}-${i}`, date, { team: 3000 + i, priority: true }),
		);
	}

	it("allows one per week", () => {
		expect(PRIORITY_PER_WEEK).toBe(1);
		const usage = weeklyUsage([], 1234, "2026-11-26", TODAY);
		expect(usage).toMatchObject({ weekStart: "2026-11-23", priorityUsed: [], priorityAllowance: 1, lines: 0 });
	});

	it("counts an upcoming priority line, even one that's waitlisted", () => {
		const full = fullOfPriority("2026-11-27"); // booked first
		const lines = [...full, line("waiting", "2026-11-27", { priority: true })];
		expect(slotStandings(lines).get("waiting")?.waitlisted).toBe(true);
		expect(weeklyUsage(lines, 1234, "2026-11-25", TODAY).priorityUsed.map(l => l.id)).toEqual(["waiting"]);
	});

	it("gives back a priority line that never got a place, once its day has passed", () => {
		const full = fullOfPriority("2026-11-23"); // booked first
		const lines = [...full, line("waited", "2026-11-23", { priority: true })];
		expect(weeklyUsage(lines, 1234, "2026-11-25", TODAY).priorityUsed).toEqual([]);
	});

	it("keeps counting a past priority line that had a place", () => {
		const lines = [line("held", "2026-11-23", { priority: true })];
		expect(weeklyUsage(lines, 1234, "2026-11-25", TODAY).priorityUsed.map(l => l.id)).toEqual(["held"]);
	});

	it("doesn't count cancelled lines, other weeks, or other teams", () => {
		const lines = [
			line("gone", "2026-11-25", { priority: true, abandoned: new Date() }),
			line("nextWeek", "2026-11-30", { priority: true }),
			line("other", "2026-11-25", { priority: true, team: 5678 }),
		];
		expect(weeklyUsage(lines, 1234, "2026-11-25", TODAY).priorityUsed).toEqual([]);
	});

	it("charges a guest's priority line to the host", () => {
		const lines = [line("guest", "2026-11-26", { priority: true, team: 9999, host: 1234 })];
		expect(weeklyUsage(lines, 1234, "2026-11-25", TODAY).priorityUsed.map(l => l.id)).toEqual(["guest"]);
		expect(weeklyUsage(lines, 9999, "2026-11-25", TODAY).priorityUsed).toEqual([]);
	});

	it("reports the lines counted toward the cap", () => {
		const lines = [line("past", "2026-11-23"), ...bookings(3), line("extra", "2026-11-25", { extraRobot: true })];
		expect(weeklyUsage(lines, 1234, "2026-11-25", TODAY)).toMatchObject({ lines: 3, cap: LINES_PER_WEEK });
	});
});
