import { describe, expect, it } from "vitest";
import { ACCESS_POST_END_GRACE_MS, ACCESS_PRE_START_GRACE_MS, evaluateUserAccess } from "~/server/access";
import type { Reservation, UserEntry } from "~/types";

const baseUser: UserEntry = {
	id: "user-1",
	name: "Jane Doe",
	displayName: "Jane Doe (1234)",
	created: new Date("2026-05-01T00:00:00Z"),
	updated: new Date("2026-05-01T00:00:00Z"),
	teams: [1234],
	email: "jane@example.com",
	image: "",
	accessToken: "tok-jane",
};

const teamReservation: Reservation = {
	id: "res-1",
	date: "2026-05-23",
	slot: "10:00am",
	created: new Date("2026-05-20T00:00:00Z"),
	userId: baseUser.id,
	priority: false,
	team: 1234,
};

// 10am LA slot ends at 4pm LA (16/23:00Z PDT). With ±grace:
//   start = 17:00Z − 30m = 16:30Z
//   end   = 23:00Z + 6h  = 05:00Z next day
const expectedStart = "2026-05-23T16:30:00.000Z";
const expectedEnd = "2026-05-24T05:00:00.000Z";

describe("evaluateUserAccess", () => {
	it("returns valid inside the window for the gate tool", () => {
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateUserAccess(baseUser, "gate", [teamReservation], inside);
		expect(result).toEqual({
			valid: true,
			tool: "gate",
			user: { id: "user-1", name: "Jane Doe (1234)" },
			team: { id: "1234", name: "Team 1234" },
			reservation_id: "res-1",
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("returns valid at the pre-start grace boundary", () => {
		const slotStart = new Date("2026-05-23T17:00:00Z");
		const atStart = new Date(slotStart.getTime() - ACCESS_PRE_START_GRACE_MS);
		const result = evaluateUserAccess(baseUser, "gate", [teamReservation], atStart);
		expect(result.valid).toBe(true);
	});

	it("returns outside_window with the nearest reservation window populated", () => {
		const before = new Date("2026-05-23T15:00:00Z");
		const result = evaluateUserAccess(baseUser, "gate", [teamReservation], before);
		expect(result).toMatchObject({
			valid: false,
			reason: "outside_window",
			tool: "gate",
			team: { id: "1234", name: "Team 1234" },
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("returns outside_window with null windows when the user has no reservations at all", () => {
		const result = evaluateUserAccess(baseUser, "gate", [], new Date());
		expect(result).toMatchObject({
			valid: false,
			reason: "outside_window",
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		});
	});

	it("ignores abandoned reservations", () => {
		const abandoned: Reservation = { ...teamReservation, abandoned: new Date("2026-05-22T00:00:00Z") };
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateUserAccess(baseUser, "gate", [abandoned], inside);
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.reason).toBe("outside_window");
	});

	it("ignores reservations for other teams", () => {
		const otherTeamRes: Reservation = { ...teamReservation, id: "res-2", team: 9999 };
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateUserAccess(baseUser, "gate", [otherTeamRes], inside);
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.reason).toBe("outside_window");
		expect(result.team).toBeNull();
	});

	it("matches reservations for any of the user's teams (multi-team)", () => {
		const multiTeamUser = { ...baseUser, teams: [1234, 5678] };
		const otherTeamRes: Reservation = { ...teamReservation, id: "res-2", team: 5678 };
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateUserAccess(multiTeamUser, "gate", [otherTeamRes], inside);
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.team).toEqual({ id: "5678", name: "Team 5678" });
	});

	it("returns revoked for disabled users", () => {
		const disabled = { ...baseUser, disabled: true };
		const result = evaluateUserAccess(disabled, "gate", [teamReservation], new Date("2026-05-23T18:00:00Z"));
		expect(result).toMatchObject({
			valid: false,
			reason: "revoked",
			user: { id: "user-1" },
		});
	});

	it("returns revoked for users with no teams", () => {
		const teamless = { ...baseUser, teams: [] };
		const result = evaluateUserAccess(teamless, "gate", [teamReservation], new Date("2026-05-23T18:00:00Z"));
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.reason).toBe("revoked");
	});

	it("returns revoked for admin users (no auto-access)", () => {
		const adminUser = { ...baseUser, teams: "admin" as const };
		const result = evaluateUserAccess(adminUser, "gate", [teamReservation], new Date("2026-05-23T18:00:00Z"));
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.reason).toBe("revoked");
	});

	it("returns tool_not_authorized for unknown tools", () => {
		const result = evaluateUserAccess(baseUser, "laser-cannon", [teamReservation], new Date("2026-05-23T18:00:00Z"));
		expect(result).toMatchObject({
			valid: false,
			reason: "tool_not_authorized",
			tool: "laser-cannon",
			user: { id: "user-1" },
		});
	});

	it("returns unknown_token when no user matches", () => {
		const result = evaluateUserAccess(undefined, "gate", [teamReservation], new Date());
		expect(result).toEqual({
			valid: false,
			reason: "unknown_token",
			tool: "gate",
			user: null,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		});
	});

	it("prefers the active reservation when one is currently in-window", () => {
		const past: Reservation = { ...teamReservation, id: "past", date: "2026-05-20" };
		const future: Reservation = { ...teamReservation, id: "future", date: "2026-05-30" };
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateUserAccess(baseUser, "gate", [past, teamReservation, future], inside);
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.reservation_id).toBe("res-1");
	});

	it("post-window: rejects after the +6h grace ends", () => {
		const slotEnd = new Date("2026-05-23T23:00:00Z");
		const after = new Date(slotEnd.getTime() + ACCESS_POST_END_GRACE_MS + 1000);
		const result = evaluateUserAccess(baseUser, "gate", [teamReservation], after);
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.reason).toBe("outside_window");
	});
});
