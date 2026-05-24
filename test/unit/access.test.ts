import { describe, expect, it } from "vitest";
import { ACCESS_POST_END_GRACE_MS, ACCESS_PRE_START_GRACE_MS, evaluateAccess } from "~/server/access";
import type { Reservation } from "~/types";

const baseReservation: Reservation = {
	id: "res-1",
	date: "2026-05-23",
	slot: "10:00am",
	created: new Date("2026-05-20T00:00:00Z"),
	userId: "user-1",
	priority: false,
	team: 1234,
	token: "tok-1234",
};

// In .env.test the time zone is America/Los_Angeles and the 10am slot ends at
// 4pm local (16:00 LA / 23:00 UTC during PDT). With grace, the window is:
//   start = 2026-05-23T17:00Z − 30m = 2026-05-23T16:30Z
//   end   = 2026-05-23T23:00Z + 6h  = 2026-05-24T05:00Z
const expectedStart = "2026-05-23T16:30:00.000Z";
const expectedEnd = "2026-05-24T05:00:00.000Z";

describe("evaluateAccess", () => {
	it("returns valid inside the window for the gate tool", () => {
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateAccess(baseReservation, "gate", inside);
		expect(result).toEqual({
			valid: true,
			tool: "gate",
			team: { id: "1234", name: "Team 1234" },
			reservation_id: "res-1",
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("returns valid exactly at the pre-start grace boundary", () => {
		const slotStart = new Date("2026-05-23T17:00:00Z");
		const atStart = new Date(slotStart.getTime() - ACCESS_PRE_START_GRACE_MS);
		const result = evaluateAccess(baseReservation, "gate", atStart);
		expect(result.valid).toBe(true);
	});

	it("returns outside_window before the grace start", () => {
		const before = new Date("2026-05-23T16:29:59Z");
		const result = evaluateAccess(baseReservation, "gate", before);
		expect(result).toMatchObject({
			valid: false,
			reason: "outside_window",
			tool: "gate",
			team: { id: "1234", name: "Team 1234" },
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("returns outside_window after the grace end", () => {
		const slotEnd = new Date("2026-05-23T23:00:00Z");
		const after = new Date(slotEnd.getTime() + ACCESS_POST_END_GRACE_MS + 1000);
		const result = evaluateAccess(baseReservation, "gate", after);
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.reason).toBe("outside_window");
	});

	it("returns revoked for abandoned reservations even inside the window", () => {
		const abandoned: Reservation = { ...baseReservation, abandoned: new Date("2026-05-22T00:00:00Z") };
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateAccess(abandoned, "gate", inside);
		expect(result).toMatchObject({
			valid: false,
			reason: "revoked",
			tool: "gate",
			team: { id: "1234", name: "Team 1234" },
		});
	});

	it("returns tool_not_authorized for unknown tools", () => {
		const inside = new Date("2026-05-23T18:00:00Z");
		const result = evaluateAccess(baseReservation, "laser-cannon", inside);
		expect(result).toMatchObject({
			valid: false,
			reason: "tool_not_authorized",
			tool: "laser-cannon",
			team: { id: "1234", name: "Team 1234" },
		});
	});

	it("returns unknown_token when no reservation matches", () => {
		const result = evaluateAccess(undefined, "gate", new Date());
		expect(result).toEqual({
			valid: false,
			reason: "unknown_token",
			tool: "gate",
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		});
	});

	it("prefers the revoked reason over tool_not_authorized when both apply", () => {
		const abandoned: Reservation = { ...baseReservation, abandoned: new Date("2026-05-22T00:00:00Z") };
		const result = evaluateAccess(abandoned, "laser-cannon", new Date("2026-05-23T18:00:00Z"));
		expect(result.valid).toBe(false);
		if (result.valid) return;
		expect(result.reason).toBe("revoked");
	});

	it("accepts string team identifiers", () => {
		const houseRes: Reservation = { ...baseReservation, team: "house-1" };
		const result = evaluateAccess(houseRes, "gate", new Date("2026-05-23T18:00:00Z"));
		expect(result.valid).toBe(true);
		if (!result.valid) return;
		expect(result.team).toEqual({ id: "house-1", name: "Team house-1" });
	});
});
