/**
 * Integration test for blackout enforcement against the real backend.
 *
 * `src/server/backend.ts` resolves DATA_DIR at import time and keeps state in module globals, so
 * DATA_DIR is pointed at a scratch directory before the module is dynamically imported.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Context as ContextClass } from "~/server/backend";

let dataDir: string;
let Context: typeof ContextClass;
let PermissionError: typeof import("~/server/backend").PermissionError;

function session(id: string, name: string): Session {
	return {
		user: { id, name, email: `${id}@example.test`, image: "" },
		expires: new Date(Date.now() + 60_000).toISOString(),
	} as unknown as Session;
}

function contextFor(id: string, name: string) {
	return new Context(session(id, name), "vitest", "127.0.0.1");
}

/** A date inside the current year, since the backend rejects anything outside it. */
function dateInThisYear(monthIndex: number, day: number): string {
	const year = new Date().getFullYear();
	return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "pfs-blackout-"));
	process.env.DATA_DIR = dataDir;

	const backend = await import("~/server/backend");
	Context = backend.Context;
	PermissionError = backend.PermissionError;
});

afterAll(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

describe("blackout enforcement", () => {
	// The first user to appear becomes an admin (FirstUserIsAdmin), so this one is the admin and
	// every later user is an ordinary member.
	const admin = () => contextFor("admin", "Admin User");
	const member = () => contextFor("member", "Team Member");

	const slot = "10:00am";

	it("lets an admin black out a single day", async () => {
		const date = dateInThisYear(5, 10);
		const { blackout } = await admin().addBlackout({ date, reason: "Resurfacing" });

		expect(blackout.date).toBe(date);
		expect(blackout.endDate).toBeUndefined();
		expect(blackout.slot).toBeUndefined();
		expect(blackout.id).toBeTruthy();

		const listed = await admin().getBlackouts();
		expect(listed.map(b => b.id)).toContain(blackout.id);
	});

	it("refuses to let a non-admin add a blackout", async () => {
		await expect(member().addBlackout({ date: dateInThisYear(5, 11) })).rejects.toBeInstanceOf(PermissionError);
	});

	it("refuses to let a non-admin remove a blackout", async () => {
		const date = dateInThisYear(5, 12);
		const { blackout } = await admin().addBlackout({ date });

		await expect(member().removeBlackout({ id: blackout.id })).rejects.toBeInstanceOf(PermissionError);
	});

	it("blocks a reservation on a blacked-out day and reopens it once removed", async () => {
		const date = dateInThisYear(6, 1);
		const { blackout } = await admin().addBlackout({ date, reason: "Field closed" });

		await expect(admin().addReservation({ date, slot, team: "1234", notes: "", priority: false })).rejects.toThrow(
			/blacked out/i,
		);

		await admin().removeBlackout({ id: blackout.id });

		const reservation = await admin().addReservation({ date, slot, team: "1234", notes: "", priority: false });
		expect(reservation.date).toBe(date);
	});

	it("blocks every day of a range", async () => {
		const first = dateInThisYear(6, 10);
		const middle = dateInThisYear(6, 11);
		const last = dateInThisYear(6, 12);
		const after = dateInThisYear(6, 13);

		await admin().addBlackout({ date: first, endDate: last, reason: "Competition" });

		for (const date of [first, middle, last]) {
			await expect(admin().addReservation({ date, slot, team: "2345", notes: "", priority: false })).rejects.toThrow(
				/blacked out/i,
			);
		}

		// The day after the range is untouched
		const ok = await admin().addReservation({ date: after, slot, team: "2345", notes: "", priority: false });
		expect(ok.date).toBe(after);
	});

	it("only blocks the named slot when the blackout is slot-scoped", async () => {
		const date = dateInThisYear(7, 4);
		await admin().addBlackout({ date, slot, reason: "Maintenance window" });

		await expect(admin().addReservation({ date, slot, team: "3456", notes: "", priority: false })).rejects.toThrow(
			/blacked out/i,
		);

		const other = await admin().addReservation({
			date,
			slot: "04:00pm",
			team: "3456",
			notes: "",
			priority: false,
		});
		expect(other.slot).toBe("04:00pm");
	});

	it("reports reservations that already exist inside a new blackout without cancelling them", async () => {
		const date = dateInThisYear(8, 5);
		const reservation = await admin().addReservation({ date, slot, team: "4567", notes: "", priority: false });

		const { conflicts } = await admin().addBlackout({ date, reason: "Late closure" });

		expect(conflicts.map(r => r.id)).toContain(reservation.id);

		// Still live: the blackout reported it rather than destroying it
		const stillThere = await admin().listReservations(date);
		expect(stillThere.map(r => r.id)).toContain(reservation.id);
	});

	it("surfaces the reason in the error a team sees", async () => {
		const date = dateInThisYear(8, 20);
		await admin().addBlackout({ date, reason: "Turf replacement" });

		await expect(admin().addReservation({ date, slot, team: "5678", notes: "", priority: false })).rejects.toThrow(
			/Turf replacement/,
		);
	});

	it("rejects a range that runs backwards", async () => {
		await expect(admin().addBlackout({ date: dateInThisYear(9, 10), endDate: dateInThisYear(9, 1) })).rejects.toThrow(
			/must not be before/i,
		);
	});
});
