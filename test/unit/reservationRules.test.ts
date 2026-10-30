import { describe, expect, it } from "vitest";
import { reservationSchema } from "~/server/api/schemas/reservation";
import { isValidTeamNumber, MAX_TEAM_NUMBER, RESERVATION_NOTES_MAX } from "~/server/util/reservation";

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
