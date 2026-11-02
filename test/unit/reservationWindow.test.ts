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
 * Only `Date` is faked, and only *after* the backend is imported: `@date-fns/tz` subclasses
 * whatever `Date` is global when it loads, and a subclass of vitest's mock quietly falls back to
 * the host's zone instead of TIME_ZONE. That passed here (Pacific) and failed on CI (UTC).
 *
 * Like test/unit/blackoutEnforcement.test.ts, this seeds users.json and points DATA_DIR at a
 * scratch directory before importing the backend, which resolves both at import time.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context as ContextClass } from "~/server/backend";

const MemberTeam = "1234";
const Slot = "10:00am";

// The backend files data by the real calendar year, so the pinned date tracks it: 17 September,
// which is in PDT whatever year this runs in.
const Year = new Date().getFullYear();
/** 22:30 on 17 September in Los Angeles; 05:30 on the 18th in UTC. */
const PinnedNow = new Date(Date.UTC(Year, 8, 18, 5, 30));
/** 08:00 the same field morning, for proving the window doesn't slide during the day. */
const PinnedMorning = new Date(Date.UTC(Year, 8, 17, 15, 0));
const FieldToday = day(0);

let dataDir: string;
let Context: typeof ContextClass;
let PermissionError: typeof import("~/server/backend").PermissionError;

function session(id: string): Session {
	return {
		user: { id, name: id, email: `${id}@example.test`, image: "" },
		expires: new Date(PinnedNow.getTime() + 3_600_000).toISOString(),
	} as unknown as Session;
}

const admin = () => new Context(session("admin"), "vitest", "127.0.0.1");
const member = () => new Context(session("member"), "vitest", "127.0.0.1");
/** Someone whose display name lists no team */
const loner = () => new Context(session("loner"), "vitest", "127.0.0.1");

/** A date `n` days from the field's today, worked out independently of the code under test. */
function day(n: number): string {
	return new Date(Date.UTC(Year, 8, 17 + n)).toISOString().slice(0, 10);
}

function book(ctx: ContextClass, date: string, slot = Slot, team = MemberTeam, host?: string) {
	return ctx.addReservation({ date, slot, team, host, notes: "", priority: false });
}

beforeAll(async () => {
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
			{
				id: "loner-uid",
				name: "No Team",
				email: "loner@example.test",
				teams: [],
				created: now,
				updated: now,
				image: "",
			},
		]),
		"utf-8",
	);

	mkdirSync(join(dataDir, new Date().getFullYear().toString()), { recursive: true });

	process.env.DATA_DIR = dataDir;
	// The window is evaluated in TIME_ZONE, so the test pins it rather than depending on whatever
	// the environment supplies.
	process.env.TIME_ZONE = "America/Los_Angeles";
	// Session ids here aren't Slack ids, so the backend would ask Slack who they are. Not over the
	// network, thanks: Slack says it doesn't know us, and the tests carry on as unidentified.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ ok: false, error: "invalid_auth" })),
	);

	const backend = await import("~/server/backend");
	Context = backend.Context;
	PermissionError = backend.PermissionError;

	// Only now that everything has loaded against the real Date.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(PinnedNow);
});

afterEach(() => {
	// Individual tests may move the clock; put it back for the next one.
	vi.setSystemTime(PinnedNow);
});

afterAll(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
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

/** Refusals warn as they're filed; keep the test output clean. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		return await run();
	} finally {
		warn.mockRestore();
	}
}

describe("team membership", () => {
	it("refuses a team the booker isn't on, and says which team they are on", async () => {
		await quietly(async () => {
			await expect(book(member(), FieldToday, "07:00pm", "5940")).rejects.toBeInstanceOf(PermissionError);
			await expect(book(member(), FieldToday, "07:00pm", "5940")).rejects.toThrow(/own team.*team 1234/);
		});
	});

	it("tells someone with no team how to get one", async () => {
		await quietly(async () => {
			await expect(book(loner(), FieldToday, "07:00pm", "5940")).rejects.toThrow(/doesn't list a team.*display name/);
		});
	});

	it("lets admins book for any team", async () => {
		const reservation = await book(admin(), FieldToday, "07:00pm", "5940");
		expect(reservation.team).toBe("5940");
	});

	it("offers each person the teams they can book for", async () => {
		expect(await member().getBookableTeams()).toEqual({ admin: false, teams: [Number(MemberTeam)] });
		expect(await loner().getBookableTeams()).toEqual({ admin: false, teams: [] });
		expect(await admin().getBookableTeams()).toEqual({ admin: true, teams: [] });
	});
});

describe("guest reservations", () => {
	it("books a visiting team as the booker's own team's guest", async () => {
		const reservation = await book(member(), day(1), "07:00pm", "5940", MemberTeam);
		expect(reservation).toMatchObject({ team: "5940", host: MemberTeam });
	});

	it("leaves an ordinary reservation without a host", async () => {
		const reservation = await book(member(), day(1), "04:00pm", MemberTeam, "");
		expect(reservation).not.toHaveProperty("host");
	});

	it("refuses hosting as a team the booker isn't on", async () => {
		await quietly(async () => {
			await expect(book(member(), day(2), "07:00pm", "5940", "4321")).rejects.toThrow(/host guests for your own team/);
			await expect(book(loner(), day(2), "07:00pm", "5940", MemberTeam)).rejects.toBeInstanceOf(PermissionError);
		});
	});

	it("refuses a team as its own guest", async () => {
		await expect(book(member(), day(2), "07:00pm", MemberTeam, MemberTeam)).rejects.toThrow(/its own guest/);
	});

	it("lets the host's members cancel it, and nobody else", async () => {
		const reservation = await book(admin(), day(3), "07:00pm", "5940", "4321");
		await quietly(() =>
			expect(member().removeReservation({ id: reservation.id })).rejects.toBeInstanceOf(PermissionError),
		);

		const hosted = await book(member(), day(3), "04:00pm", "5940", MemberTeam);
		const removed = await member().removeReservation({ id: hosted.id });
		expect(removed.abandoned).toBeDefined();
	});
});

describe("a team with guests and extra robots", () => {
	const teamsIn = async (date: string, slot: string) =>
		(await member().listReservations(date)).filter(r => r.slot === slot).map(r => String(r.team));

	const extraRobot = (date: string, slot: string, team = MemberTeam, host?: string) =>
		member().addReservation({ date, slot, team, host, notes: "", extraRobot: true, priority: false });

	it("lets a team that has the slot add guests, one line each", async () => {
		await book(member(), day(4), "07:00pm");
		await book(member(), day(4), "07:00pm", "5940", MemberTeam);
		await book(member(), day(4), "07:00pm", "8033", MemberTeam);

		expect(await teamsIn(day(4), "07:00pm")).toEqual([MemberTeam, "5940", "8033"]);
	});

	it("refuses a second line for a team, and says how to add a robot", async () => {
		await book(member(), day(5), "04:00pm");
		await expect(book(member(), day(5), "04:00pm")).rejects.toThrow(/already has this slot.*Extra robot/);
		expect(await teamsIn(day(5), "04:00pm")).toEqual([MemberTeam]);
	});

	it("gives each extra robot a line of its own", async () => {
		await book(member(), day(5), "07:00pm");
		const second = await extraRobot(day(5), "07:00pm");
		await extraRobot(day(5), "07:00pm");

		expect(second.extraRobot).toBe(true);
		expect(await teamsIn(day(5), "07:00pm")).toEqual([MemberTeam, MemberTeam, MemberTeam]);
	});

	it("takes an extra robot for a guest, and on a first line too", async () => {
		const first = await extraRobot(day(6), "07:00pm");
		expect(first.extraRobot).toBe(true);

		await book(member(), day(6), "07:00pm", "5940", MemberTeam);
		await extraRobot(day(6), "07:00pm", "5940", MemberTeam);
		expect(await teamsIn(day(6), "07:00pm")).toEqual([MemberTeam, "5940", "5940"]);
	});

	it("leaves the flag off an ordinary line", async () => {
		expect(await book(member(), day(6), "10:00am")).not.toHaveProperty("extraRobot");
	});

	it("refuses a team that is already in the slot as someone's guest", async () => {
		await book(member(), day(4), "10:00am", "5940", MemberTeam);
		await expect(book(admin(), day(4), "10:00am", "5940")).rejects.toThrow(/already has this slot/);
	});

	it("matches a stored team however its number was written", async () => {
		await member().addReservation({ date: day(6), slot: "04:00pm", team: 1234, priority: false });
		await expect(book(member(), day(6), "04:00pm")).rejects.toThrow(/already has this slot/);
	});

	it("frees the slot again once the reservation is cancelled", async () => {
		const reservation = await book(member(), day(7), "07:00pm");
		await member().removeReservation({ id: reservation.id });
		expect((await book(member(), day(7), "07:00pm")).id).not.toBe(reservation.id);
	});
});

describe("notes", () => {
	it("keeps a note from the booking, and leaves out an empty one", async () => {
		const noted = await member().addReservation({
			date: day(3),
			slot: "10:00am",
			team: MemberTeam,
			notes: "Arriving late",
			priority: false,
		});
		expect(noted.notes).toBe("Arriving late");
		expect(await book(member(), day(3), "10:00am", "5940", MemberTeam)).not.toHaveProperty("notes");
	});

	it("lets the team change or clear a note later", async () => {
		const reservation = await book(member(), day(2), "10:00am");

		expect((await member().setReservationNotes({ id: reservation.id, notes: "Bringing a guest" })).notes).toBe(
			"Bringing a guest",
		);
		expect((await member().listReservations(day(2))).find(r => r.id === reservation.id)?.notes).toBe(
			"Bringing a guest",
		);

		expect((await member().setReservationNotes({ id: reservation.id, notes: "" })).notes).toBeUndefined();
	});

	it("lets a guest's host change its note", async () => {
		const reservation = await book(member(), day(2), "04:00pm", "5940", MemberTeam);
		expect((await member().setReservationNotes({ id: reservation.id, notes: "Rookies" })).notes).toBe("Rookies");
	});

	it("refuses anyone else, as cancelling does", async () => {
		const reservation = await book(admin(), day(2), "07:00pm", "5940");
		await quietly(() =>
			expect(member().setReservationNotes({ id: reservation.id, notes: "Mine now" })).rejects.toBeInstanceOf(
				PermissionError,
			),
		);
		expect((await admin().setReservationNotes({ id: reservation.id, notes: "Admin note" })).notes).toBe("Admin note");
	});

	it("refuses a reservation that doesn't exist", async () => {
		await expect(member().setReservationNotes({ id: "nope", notes: "x" })).rejects.toThrow(/not found/);
	});
});

describe("error records", () => {
	type ErrorLine = { timestamp: string; source: string; kind: string; message: string; userId?: string; page?: string };

	const errorsFile = () => join(dataDir, String(new Date().getFullYear()), "errors.txt");
	const records = (): ErrorLine[] =>
		existsSync(errorsFile())
			? readFileSync(errorsFile(), "utf-8")
					.split("\n")
					.filter(Boolean)
					.map(line => JSON.parse(line) as ErrorLine)
			: [];

	it("files every refusal with who and what, for review later", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await expect(book(member(), day(-2), "04:00pm")).rejects.toBeInstanceOf(PermissionError);
		} finally {
			warn.mockRestore();
		}
		await vi.waitFor(() => {
			const refused = records().filter(r => r.kind === "refused");
			expect(refused.at(-1)).toMatchObject({
				source: "server",
				message: "Cannot reserve a date in the past",
				userId: "member-uid",
			});
		});
	});

	it("files what a browser reports, with who and where, and caps a runaway page", async () => {
		const ctx = member();
		expect(await ctx.reportClientError({ kind: "render", message: "boom", page: "/" })).toEqual({ recorded: true });
		await vi.waitFor(() =>
			expect(records().find(r => r.kind === "render")).toMatchObject({
				source: "client",
				message: "boom",
				userId: "member-uid",
				page: "/",
			}),
		);

		let recorded = 0;
		for (let i = 0; i < 40; i++) {
			if ((await ctx.reportClientError({ kind: "unhandled", message: `spam ${i}` })).recorded) recorded++;
		}
		// 30 a minute per person, and one was already used above
		expect(recorded).toBe(29);
	});
});
