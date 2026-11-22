import { describe, expect, it } from "vitest";
import { reservationSchema } from "~/server/api/schemas/reservation";
import {
	gotPriorityPlace,
	isValidTeamNumber,
	MAX_TEAM_NUMBER,
	orderSlot,
	RESERVATION_NOTES_MAX,
	SLOT_CAPACITY,
	slotStandings,
	standingChanges,
} from "~/server/util/reservation";

describe("isValidTeamNumber", () => {
	it.each(["1", "254", "9999", "100000"])("accepts %s", team => {
		expect(isValidTeamNumber(team)).toBe(true);
	});

	it("accepts a stored number", () => {
		expect(isValidTeamNumber(1234)).toBe(true);
	});

	it.each(["", "0", "00", "-5", "+5", "1.5", "1e3", "0254", "254a", "12 34", " 254", "254\n", "abc"])(
		"refuses %j",
		team => {
			expect(isValidTeamNumber(team)).toBe(false);
		},
	);

	it("refuses numbers past the limit", () => {
		expect(isValidTeamNumber(String(MAX_TEAM_NUMBER + 1))).toBe(false);
		expect(isValidTeamNumber("123456789012345678901234567890")).toBe(false);
	});
});

describe("the reservation schema", () => {
	const booking = {
		date: "2026-05-27",
		slot: "04:00pm",
		team: "1234",
		notes: "",
		extraRobot: false,
		priority: false,
	};
	const accepts = (change: Record<string, unknown>) => reservationSchema.safeParse({ ...booking, ...change }).success;

	it("accepts a team, a guest, and an extra robot", () => {
		expect(accepts({})).toBe(true);
		expect(accepts({ team: "5678", host: "1234" })).toBe(true);
		expect(accepts({ extraRobot: true })).toBe(true);
	});

	it("accepts a booking from a tab opened before extra robots existed", () => {
		const { extraRobot: _, ...fromAnOlderClient } = booking;

		expect(reservationSchema.parse(fromAnOlderClient).extraRobot).toBe(false);
	});

	it.each(["0", "-1", "12a", "1234 and friends", "1234\n"])("refuses team %j", team => {
		expect(accepts({ team })).toBe(false);
	});

	it("refuses a bad host", () => {
		expect(accepts({ team: "5678", host: "0" })).toBe(false);
	});

	it("trims a note, and refuses a long or multi-line one", () => {
		expect(reservationSchema.parse({ ...booking, notes: "  Late  " }).notes).toBe("Late");

		expect(accepts({ notes: "x".repeat(RESERVATION_NOTES_MAX) })).toBe(true);
		expect(accepts({ notes: "x".repeat(RESERVATION_NOTES_MAX + 1) })).toBe(false);
		expect(accepts({ notes: "one\ntwo" })).toBe(false);
	});
});

describe("a slot's order and waitlist", () => {
	const at = (minute: number) => new Date(Date.UTC(2026, 4, 20, 12, minute));
	const line = (id: string, minute: number, priority = false, abandoned?: Date) => ({
		id,
		priority,
		created: at(minute),
		...(abandoned ? { abandoned } : {}),
	});
	const ids = (lines: readonly { id: string }[]) => lines.map(l => l.id);
	const waitlistedIn = (lines: Parameters<typeof slotStandings>[0]) =>
		[...slotStandings(lines)].filter(([, s]) => s.waitlisted).map(([id]) => id);

	it("puts priority lines first, each group in booking order", () => {
		const lines = [line("a", 1), line("p2", 5, true), line("b", 2), line("p1", 3, true)];
		expect(ids(orderSlot(lines))).toEqual(["p1", "p2", "a", "b"]);
	});

	it("keeps lines booked in the same instant in the order they were stored", () => {
		expect(ids(orderSlot([line("x", 1), line("y", 1), line("z", 1)]))).toEqual(["x", "y", "z"]);
	});

	it("reads created dates that came over the wire as strings", () => {
		const lines = [
			{ id: "late", priority: false, created: at(9).toISOString() as unknown as Date },
			{ id: "early", priority: false, created: at(1).toISOString() as unknown as Date },
		];
		expect(ids(orderSlot(lines))).toEqual(["early", "late"]);
	});

	it("waitlists every line past the slot's places, and refuses nobody", () => {
		const lines = Array.from({ length: SLOT_CAPACITY + 2 }, (_, i) => line(`l${i}`, i));
		const standing = slotStandings(lines);
		expect(standing.get("l0")).toEqual({ place: 1, waitlisted: false });
		expect(standing.get(`l${SLOT_CAPACITY - 1}`)).toEqual({ place: SLOT_CAPACITY, waitlisted: false });
		expect(waitlistedIn(lines)).toEqual([`l${SLOT_CAPACITY}`, `l${SLOT_CAPACITY + 1}`]);
	});

	it("skips cancelled lines, so the waitlist moves up", () => {
		const lines = Array.from({ length: SLOT_CAPACITY + 1 }, (_, i) => line(`l${i}`, i));
		lines[0] = line("l0", 0, false, at(30));
		expect(waitlistedIn(lines)).toEqual([]);
		expect(slotStandings(lines).has("l0")).toBe(false);
	});

	it("lets a late priority line push the newest ordinary line onto the waitlist", () => {
		const full = Array.from({ length: SLOT_CAPACITY }, (_, i) => line(`l${i}`, i));
		const before = slotStandings(full);
		const after = slotStandings([...full, line("late", 50, true)]);

		expect(after.get("late")).toEqual({ place: 1, waitlisted: false });
		expect(standingChanges(before, after)).toEqual({ bumped: [`l${SLOT_CAPACITY - 1}`], promoted: [] });
	});

	it("waitlists a priority line when the places all went to priority lines first", () => {
		const full = Array.from({ length: SLOT_CAPACITY }, (_, i) => line(`p${i}`, i, true));
		const late = line("late", 50, true);
		const standing = slotStandings([...full, late]).get("late");

		expect(standing?.waitlisted).toBe(true);
		expect(gotPriorityPlace(late, standing)).toBe(false);
		expect(gotPriorityPlace(full[0] as (typeof full)[0], slotStandings(full).get("p0"))).toBe(true);
	});

	it("never counts an ordinary line as a priority place", () => {
		expect(gotPriorityPlace({ priority: false }, { place: 1, waitlisted: false })).toBe(false);
	});

	it("reports who comes off the waitlist when a place frees up", () => {
		const lines = Array.from({ length: SLOT_CAPACITY + 1 }, (_, i) => line(`l${i}`, i));
		const before = slotStandings(lines);
		const after = slotStandings(lines.slice(1));
		expect(standingChanges(before, after)).toEqual({ bumped: [], promoted: [`l${SLOT_CAPACITY}`] });
	});
});
