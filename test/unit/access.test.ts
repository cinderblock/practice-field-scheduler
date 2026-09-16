import { describe, expect, it } from "vitest";
import {
	ACCESS_POST_END_GRACE_MS,
	ACCESS_PRE_START_GRACE_MS,
	evaluateTeamAccess,
	evaluateUserAccess,
} from "~/server/access";
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

// The 10am LA slot runs to 4pm LA — 17:00Z to 23:00Z on this date (PDT).
// With the configured grace:
//   start = 17:00Z − 20m = 16:40Z
//   end   = 23:00Z + 60m = 00:00Z next day
const expectedStart = "2026-05-23T16:40:00.000Z";
const expectedEnd = "2026-05-24T00:00:00.000Z";

const inside = new Date("2026-05-23T18:00:00Z");

describe("grace constants", () => {
	it("are 20 minutes before and 60 minutes after", () => {
		expect(ACCESS_PRE_START_GRACE_MS).toBe(20 * 60 * 1000);
		expect(ACCESS_POST_END_GRACE_MS).toBe(60 * 60 * 1000);
	});
});

describe("evaluateTeamAccess", () => {
	it("returns valid inside the window for the gate tool", () => {
		expect(evaluateTeamAccess(1234, "gate", [teamReservation], inside)).toEqual({
			valid: true,
			tool: "gate",
			// Shared team link: the scheduler can't know which person clicked.
			user: null,
			team: { id: "1234", name: "Team 1234" },
			reservation_id: "res-1",
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("returns valid exactly at the pre-start grace boundary", () => {
		const atStart = new Date(expectedStart);
		expect(evaluateTeamAccess(1234, "gate", [teamReservation], atStart)).toMatchObject({ valid: true });
	});

	it("rejects one millisecond before the window opens", () => {
		const justBefore = new Date(new Date(expectedStart).getTime() - 1);
		expect(evaluateTeamAccess(1234, "gate", [teamReservation], justBefore)).toMatchObject({
			valid: false,
			reason: "outside_window",
		});
	});

	it("rejects once the post-end grace has elapsed", () => {
		const after = new Date(new Date(expectedEnd).getTime() + 1);
		expect(evaluateTeamAccess(1234, "gate", [teamReservation], after)).toMatchObject({
			valid: false,
			reason: "outside_window",
		});
	});

	it("reports the nearest window on a denial so the UI can explain itself", () => {
		const wayBefore = new Date("2026-05-20T00:00:00Z");
		expect(evaluateTeamAccess(1234, "gate", [teamReservation], wayBefore)).toEqual({
			valid: false,
			reason: "outside_window",
			tool: "gate",
			user: null,
			team: { id: "1234", name: "Team 1234" },
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("returns null windows when the team has no reservations at all", () => {
		expect(evaluateTeamAccess(1234, "gate", [], inside)).toEqual({
			valid: false,
			reason: "outside_window",
			tool: "gate",
			user: null,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		});
	});

	it("returns unknown_token when the token matched no team", () => {
		expect(evaluateTeamAccess(undefined, "gate", [teamReservation], inside)).toEqual({
			valid: false,
			reason: "unknown_token",
			tool: "gate",
			user: null,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		});
	});

	it("returns tool_not_authorized for tools we don't recognise", () => {
		expect(evaluateTeamAccess(1234, "lights", [teamReservation], inside)).toMatchObject({
			valid: false,
			reason: "tool_not_authorized",
			tool: "lights",
		});
	});

	it("ignores abandoned reservations", () => {
		const abandoned: Reservation = { ...teamReservation, abandoned: new Date("2026-05-22T00:00:00Z") };
		expect(evaluateTeamAccess(1234, "gate", [abandoned], inside)).toMatchObject({ valid: false });
	});

	it("ignores reservations belonging to another team", () => {
		expect(evaluateTeamAccess(5678, "gate", [teamReservation], inside)).toMatchObject({
			valid: false,
			reason: "outside_window",
			team: null,
		});
	});

	it("matches a numeric-string team against a numeric reservation", () => {
		expect(evaluateTeamAccess("1234", "gate", [teamReservation], inside)).toMatchObject({ valid: true });
	});

	it("matches non-numeric house teams by string", () => {
		const houseReservation: Reservation = { ...teamReservation, id: "res-house", team: "TSL" };
		expect(evaluateTeamAccess("TSL", "gate", [houseReservation], inside)).toMatchObject({
			valid: true,
			team: { id: "TSL", name: "Team TSL" },
		});
	});

	it("prefers an active reservation over a merely nearby one", () => {
		const earlier: Reservation = { ...teamReservation, id: "res-early", date: "2026-05-22" };
		expect(evaluateTeamAccess(1234, "gate", [earlier, teamReservation], inside)).toMatchObject({
			valid: true,
			reservation_id: "res-1",
		});
	});
});

// The per-user model isn't on the live path, but it stays implemented and
// tested so it can be reinstated by changing the token lookup in backend.ts
// rather than rewriting policy. See plans/gate-access-integration.md.
describe("evaluateUserAccess", () => {
	it("returns valid inside the window and attributes the open to the user", () => {
		expect(evaluateUserAccess(baseUser, "gate", [teamReservation], inside)).toEqual({
			valid: true,
			tool: "gate",
			user: { id: "user-1", name: "Jane Doe (1234)" },
			team: { id: "1234", name: "Team 1234" },
			reservation_id: "res-1",
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("matches reservations for any of a multi-team user's teams", () => {
		const multi: UserEntry = { ...baseUser, teams: [1111, 1234] };
		expect(evaluateUserAccess(multi, "gate", [teamReservation], inside)).toMatchObject({ valid: true });
	});

	it("returns revoked for a disabled user, even for an unknown tool", () => {
		const disabled: UserEntry = { ...baseUser, disabled: true };
		expect(evaluateUserAccess(disabled, "lights", [teamReservation], inside)).toMatchObject({
			valid: false,
			reason: "revoked",
		});
	});

	it("returns revoked for a user with no teams", () => {
		const teamless: UserEntry = { ...baseUser, teams: [] };
		expect(evaluateUserAccess(teamless, "gate", [teamReservation], inside)).toMatchObject({
			valid: false,
			reason: "revoked",
		});
	});

	it("returns revoked for admins — they get access via a team, not the role", () => {
		const admin: UserEntry = { ...baseUser, teams: "admin" };
		expect(evaluateUserAccess(admin, "gate", [teamReservation], inside)).toMatchObject({
			valid: false,
			reason: "revoked",
		});
	});

	it("returns unknown_token when no user matched", () => {
		expect(evaluateUserAccess(undefined, "gate", [teamReservation], inside)).toMatchObject({
			valid: false,
			reason: "unknown_token",
		});
	});
});
