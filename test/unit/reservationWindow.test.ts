/**
 * The bookable window, tested against the real backend.
 *
 * This is the regression test for the production failure of 2026-09-17: no non-admin could book
 * any slot, including the evening they were standing on the field. `restrictTimeframe` compared
 * `new Date("YYYY-MM-DD")` (midnight UTC) against `setHours(0, 0, 0, 0)` (midnight where the
 * server happens to live), so in Pacific "today" always read as the past. The bug had been dormant
 * for over a year because the call was missing its `await`; two commits adding one switched the
 * check on.
 *
 * The clock is pinned to 22:30 in Los Angeles, when the field's calendar day (the 17th) and UTC's
 * (the 18th) disagree. That makes the test fail on the old code whatever zone the test host is in,
 * which is the point: CI runs in UTC and a developer's machine here does not.
 *
 * Only `Date` is faked; the real timers keep running so the backend's locks and writes behave.
 *
 * Like test/unit/blackoutEnforcement.test.ts, this seeds users.json and points DATA_DIR at a
 * scratch directory before importing the backend, which resolves both at import time.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context as ContextClass } from "~/server/backend";

const MemberTeam = "1234";
const Slot = "10:00am";

/** 22:30 on 17 September in Los Angeles; 05:30 on the 18th in UTC. */
const FieldToday = "2026-09-17";
const PinnedNow = new Date("2026-09-18T05:30:00Z");
/** 08:00 the same field morning, for proving the window doesn't slide during the day. */
const PinnedMorning = new Date("2026-09-17T15:00:00Z");

let dataDir: string;
let Context: typeof ContextClass;
let PermissionError: typeof import("~/server/backend").PermissionError;

function session(id: string): Session {
	return {
		user: { id, name: id, email: `${id}@example.test`, image: "" },
		expires: new Date(PinnedNow.getTime() + 60_000).toISOString(),
	} as unknown as Session;
}

const admin = () => new Context(session("admin"), "vitest", "127.0.0.1");
const member = () => new Context(session("member"), "vitest", "127.0.0.1");

/** A date `n` days from the field's today. Plain string arithmetic on a known date. */
function day(n: number): string {
	const d = new Date(Date.UTC(2026, 8, 17 + n));
	return d.toISOString().slice(0, 10);
}

function book(ctx: ContextClass, date: string, slot = Slot, team = MemberTeam) {
	return ctx.addReservation({ date, slot, team, notes: "", priority: false });
}

beforeAll(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(PinnedNow);

	dataDir = mkdtempSync(join(tmpdir(), "pfs-window-"));
	const now = PinnedNow.toISOString();

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

	const backend = await import("~/server/backend");
	Context = backend.Context;
	PermissionError = backend.PermissionError;
});

afterEach(() => {
	// Individual tests may move the clock; put it back for the next one.
	vi.setSystemTime(PinnedNow);
});

afterAll(() => {
	vi.useRealTimers();
	rmSync(dataDir, { recursive: true, force: true });
});

describe("the bookable window", () => {
	it("lets a team book the evening it is standing in", async () => {
		const reservation = await book(member(), FieldToday);
		expect(reservation.date).toBe(FieldToday);
	});

	it("refuses yesterday", async () => {
		await expect(book(member(), day(-1))).rejects.toBeInstanceOf(PermissionError);
		await expect(book(member(), day(-1))).rejects.toThrow(/in the past/i);
	});

	it("allows the last day of the window and refuses the day after it", async () => {
		const last = await book(member(), day(7));
		expect(last.date).toBe(day(7));

		await expect(book(member(), day(8))).rejects.toThrow(/more than 7 days in advance/i);
	});

	it("keeps the same seven days bookable all day long", async () => {
		// The old check measured from `Date.now()`, so the far end of the window drifted with the
		// time of day: bookable in the morning, refused the same evening.
		vi.setSystemTime(PinnedMorning);

		const today = await book(member(), FieldToday, "04:00pm");
		expect(today.date).toBe(FieldToday);

		const last = await book(member(), day(7), "04:00pm");
		expect(last.date).toBe(day(7));

		await expect(book(member(), day(8), "04:00pm")).rejects.toThrow(/in advance/i);
	});

	it("exempts admins from the window", async () => {
		const past = await book(admin(), day(-30), Slot, "4321");
		expect(past.date).toBe(day(-30));

		const distant = await book(admin(), day(60), Slot, "4321");
		expect(distant.date).toBe(day(60));
	});
});

describe("team membership", () => {
	it("lets a user book for a team they are not recorded on, and logs it", async () => {
		// EnforceTeamMembership is off: user records mostly have no teams, so enforcing it would
		// lock the club out. The refusal is logged instead, so the journal shows what turning it on
		// would block. Flip that constant and this test is the one that tells you.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const reservation = await book(member(), FieldToday, "07:00pm", "5940");
			expect(reservation.team).toBe("5940");
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("team mismatch"), expect.anything());
		} finally {
			warn.mockRestore();
		}
	});
});
