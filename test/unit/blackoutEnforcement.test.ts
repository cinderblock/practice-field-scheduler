/**
 * Integration test for blackout enforcement against the real backend.
 *
 * `src/server/backend.ts` resolves DATA_DIR at import time and keeps state in module globals, so
 * DATA_DIR is pointed at a scratch directory before the module is dynamically imported.
 *
 * `users.json` is seeded rather than relying on FirstUserIsAdmin, because these tests need both an
 * admin and an ordinary member of a specific team.
 *
 * Dates for member bookings are relative to today: a non-admin is also bound by the 7-day advance
 * window, so only days +1..+6 are usable for them. Admins ignore that window and use fixed dates.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context as ContextClass } from "~/server/backend";

const MemberTeam = "1234";
const Slot = "10:00am";
const OtherSlot = "04:00pm";

let dataDir: string;
let Context: typeof ContextClass;
let PermissionError: typeof import("~/server/backend").PermissionError;

function session(id: string): Session {
	return {
		user: { id, name: id, email: `${id}@example.test`, image: "" },
		expires: new Date(Date.now() + 60_000).toISOString(),
	} as unknown as Session;
}

/** Admin: exempt from both the advance-reservation window and blackouts. */
const admin = () => new Context(session("admin"), "vitest", "127.0.0.1");
/** Ordinary member of MemberTeam: bound by both. */
const member = () => new Context(session("member"), "vitest", "127.0.0.1");

function pad(n: number) {
	return String(n).padStart(2, "0");
}

/** A date `n` days from today, in local time so it lines up with the backend's window check. */
function inDays(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A fixed date in the current year, for admin-only operations that ignore the window. */
function dateInThisYear(monthIndex: number, day: number): string {
	return `${new Date().getFullYear()}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function book(ctx: ContextClass, date: string, slot = Slot, team = MemberTeam) {
	return ctx.addReservation({ date, slot, team, notes: "", priority: false });
}

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "pfs-blackout-"));
	const now = new Date().toISOString();

	writeFileSync(
		join(dataDir, "users.json"),
		JSON.stringify([
			{
				id: "admin-uid",
				name: "Admin User",
				email: "admin@example.test",
				teams: "admin",
				created: now,
				updated: now,
				image: "",
			},
			{
				id: "member-uid",
				name: "Team Member",
				email: "member@example.test",
				teams: [Number(MemberTeam)],
				created: now,
				updated: now,
				image: "",
			},
		]),
		"utf-8",
	);

	mkdirSync(join(dataDir, new Date().getFullYear().toString()), { recursive: true });

	process.env.DATA_DIR = dataDir;
	// Session ids here aren't Slack ids, so the backend would ask Slack who they are. Not over the
	// network, thanks: Slack says it doesn't know us, and the tests carry on as unidentified.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ ok: false, error: "invalid_auth" })),
	);

	const backend = await import("~/server/backend");
	Context = backend.Context;
	PermissionError = backend.PermissionError;
});

afterAll(() => {
	vi.unstubAllGlobals();
	rmSync(dataDir, { recursive: true, force: true });
});

describe("blackout management permissions", () => {
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
		const { blackout } = await admin().addBlackout({ date: dateInThisYear(5, 12) });

		await expect(member().removeBlackout({ id: blackout.id })).rejects.toBeInstanceOf(PermissionError);
	});

	it("rejects a range that runs backwards", async () => {
		await expect(admin().addBlackout({ date: dateInThisYear(9, 10), endDate: dateInThisYear(9, 1) })).rejects.toThrow(
			/must not be before/i,
		);
	});
});

describe("blackout enforcement", () => {
	it("blocks a team from booking a blacked-out day, and reopens it once removed", async () => {
		const date = inDays(1);
		const { blackout } = await admin().addBlackout({ date, reason: "Field closed" });

		await expect(book(member(), date)).rejects.toBeInstanceOf(PermissionError);

		await admin().removeBlackout({ id: blackout.id });

		const reservation = await book(member(), date);
		expect(reservation.date).toBe(date);
	});

	it("tells the team why, and still lets an admin book over it", async () => {
		const date = inDays(2);
		await admin().addBlackout({ date, reason: "Turf replacement" });

		await expect(book(member(), date)).rejects.toThrow(/Turf replacement/);

		// Admins are exempt: they set the blackout, so they can book across one
		const reservation = await book(admin(), date, Slot, "9999");
		expect(reservation.date).toBe(date);
	});

	it("blocks a team on every day of a range but not the day after", async () => {
		const first = inDays(3);
		const last = inDays(4);
		const after = inDays(5);

		await admin().addBlackout({ date: first, endDate: last, reason: "Competition" });

		for (const date of [first, last]) {
			await expect(book(member(), date)).rejects.toBeInstanceOf(PermissionError);
		}

		const ok = await book(member(), after);
		expect(ok.date).toBe(after);
	});

	it("only blocks the named slot when the blackout is slot-scoped", async () => {
		const date = inDays(6);
		await admin().addBlackout({ date, slot: Slot, reason: "Maintenance window" });

		await expect(book(member(), date, Slot)).rejects.toBeInstanceOf(PermissionError);

		const other = await book(member(), date, OtherSlot);
		expect(other.slot).toBe(OtherSlot);
	});

	it("reports reservations that already exist inside a new blackout without cancelling them", async () => {
		const date = dateInThisYear(8, 5);
		const reservation = await book(admin(), date, Slot, "4567");

		const { conflicts } = await admin().addBlackout({ date, reason: "Late closure" });

		expect(conflicts.map(r => r.id)).toContain(reservation.id);

		// Still live: the blackout reported it rather than destroying it
		const stillThere = await admin().listReservations(date);
		expect(stillThere.map(r => r.id)).toContain(reservation.id);
	});
});
