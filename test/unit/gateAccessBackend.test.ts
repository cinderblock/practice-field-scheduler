/**
 * End-to-end over the real backend: sign-ins issue and DM links, the token
 * index answers /api/access/check, and admin actions (rotate, block) take
 * effect immediately. Runs against a throwaway DATA_DIR with Slack stubbed at
 * `fetch`, and with only `Date` faked so the change lock still behaves.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "pfs-gate-access-"));
process.env.DATA_DIR = dataDir;

vi.useFakeTimers({ toFake: ["Date"] });
// Saturday 11am PDT.
vi.setSystemTime(new Date("2026-05-23T18:00:00Z"));

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
	Response.json({ ok: true, channel: "D1", ts: "1" }),
);
vi.stubGlobal("fetch", fetchMock);

const { Context, checkAccess, PermissionError } = await import("~/server/backend");

afterAll(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	rmSync(dataDir, { recursive: true, force: true });
});

type Dm = { channel: string; text: string };

const dms = (): Dm[] => fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as Dm);
const dmsTo = (slackId: string) => dms().filter(d => d.channel === slackId);
const lastDmTo = (slackId: string) => dmsTo(slackId).at(-1) as Dm;
const tokensIn = (text: string) => [...text.matchAll(/\/g\/([A-Za-z0-9_-]{32})/g)].map(m => m[1] as string);

/** Let fire-and-forget DM work finish, so "nothing was sent" is a real observation. */
const settle = () => new Promise(resolve => setTimeout(resolve, 100));

function session(slackId: string, displayName: string, email: string): Session {
	return {
		user: { id: slackId, name: displayName.replace(/\s*\(.*\)$/, ""), displayName, email, image: "" },
		expires: "2099-01-01T00:00:00.000Z",
	};
}

async function signIn(slackId: string, displayName: string, email: string) {
	const ctx = new Context(session(slackId, displayName, email), "vitest", "127.0.0.1");
	await ctx.getTeams(); // resolves (and creates/syncs) the user
	return ctx;
}

const ADA = { slack: "U_ADA", name: "Ada Admin (TSL)", email: "ada@example.com" };
const JANE = { slack: "U_JANE", name: "Jane Doe (1234, 5678)", email: "jane@example.com" };
const BOB = { slack: "U_BOB", name: "Bob Roe (1234)", email: "bob@example.com" };

// Shared across the sequential steps below.
let admin: InstanceType<typeof Context>;
let jane: InstanceType<typeof Context>;
let janeId: string;
let bobId: string;
let janePersonal: string;
let team1234: string;
let team5678: string;

describe("gate access, end to end", () => {
	it("gives the first user (an admin lab mate) a personal link and nothing else", async () => {
		admin = await signIn(ADA.slack, ADA.name, ADA.email);
		expect(await admin.getTeams()).toBe("admin");

		await vi.waitFor(() => expect(dmsTo(ADA.slack)).toHaveLength(1));
		const tokens = tokensIn(lastDmTo(ADA.slack).text);
		expect(tokens).toHaveLength(1);
		expect(lastDmTo(ADA.slack).text).toContain("personal link");

		expect(await checkAccess(tokens[0] as string, "gate")).toMatchObject({
			valid: true,
			grant: "personal",
			user: { name: ADA.name },
		});
	});

	it("sends a two-team mentor all three links in one DM", async () => {
		jane = await signIn(JANE.slack, JANE.name, JANE.email);
		expect(await jane.getTeams()).toEqual([1234, 5678]);

		await vi.waitFor(() => expect(dmsTo(JANE.slack)).toHaveLength(1));
		const text = lastDmTo(JANE.slack).text;
		expect(tokensIn(text)).toHaveLength(3);

		const results = await Promise.all(tokensIn(text).map(async t => ({ t, r: await checkAccess(t, "gate") })));
		const personal = results.filter(x => x.r.grant === "personal");
		const teams = results.filter(x => x.r.grant === "team");
		expect(personal).toHaveLength(1);
		expect(teams).toHaveLength(2);

		janePersonal = personal[0]?.t as string;
		expect(personal[0]?.r).toMatchObject({ valid: true, team: null, reservation_id: null });

		// No reservations yet, so the team links are shut.
		for (const { r } of teams) expect(r).toMatchObject({ valid: false, reason: "outside_window" });

		const admins = await admin.listTeamAccess();
		expect(admins.map(t => String(t.team))).toEqual(["1234", "5678"]);
		// Reveal tells us which shared token belongs to which team.
		team1234 = (await admin.revealTeamAccessLink(1234)).token;
		team5678 = (await admin.revealTeamAccessLink(5678)).token;
		expect(tokensIn(text)).toEqual(expect.arrayContaining([janePersonal, team1234, team5678]));

		const users = await admin.getUsers();
		janeId = users.find(u => u.displayName === JANE.name)?.id as string;
	});

	it("doesn't re-send links on a later sign-in", async () => {
		jane = await signIn(JANE.slack, JANE.name, JANE.email);
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(1);
	});

	it("gives a teammate the same shared team link, but their own personal link", async () => {
		await signIn(BOB.slack, BOB.name, BOB.email);
		await vi.waitFor(() => expect(dmsTo(BOB.slack)).toHaveLength(1));

		const tokens = tokensIn(lastDmTo(BOB.slack).text);
		expect(tokens).toHaveLength(2);
		expect(tokens).toContain(team1234);
		expect(tokens).not.toContain(janePersonal);

		const users = await admin.getUsers();
		bobId = users.find(u => u.displayName === BOB.name)?.id as string;
		expect((await admin.revealPersonalAccessLink(bobId)).token).toBe(tokens.find(t => t !== team1234));
	});

	it("opens a team link around a reservation, and tells the rest of the team", async () => {
		// Book tomorrow (a date-only string is UTC midnight, so "today" can read as
		// the past on a machine west of UTC), then move the clock into the window.
		const reservation = await jane.addReservation({
			date: "2026-05-24",
			slot: "10:00am",
			team: 1234,
			priority: false,
		});
		await vi.waitFor(() => expect(dmsTo(BOB.slack)).toHaveLength(2));
		expect(lastDmTo(BOB.slack).text).toContain(`/g/${team1234}`);
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(1); // the creator isn't told about their own booking

		vi.setSystemTime(new Date("2026-05-24T18:00:00Z"));
		expect(await checkAccess(team1234, "gate")).toMatchObject({
			valid: true,
			grant: "team",
			team: { id: "1234" },
			reservation_id: reservation.id,
			user: null,
		});
		// Jane's other team has no booking.
		expect(await checkAccess(team5678, "gate")).toMatchObject({ valid: false, reason: "outside_window" });
	});

	it("rotating a team link kills the old one and DMs every member the new one", async () => {
		const result = await admin.rotateTeamAccessLink(1234);
		expect(result).toMatchObject({ notified: 2, failed: 0 });

		expect(await checkAccess(team1234, "gate")).toMatchObject({ valid: false, reason: "unknown_token" });

		const rotated = tokensIn(lastDmTo(BOB.slack).text);
		expect(rotated).toHaveLength(1);
		expect(tokensIn(lastDmTo(JANE.slack).text)).toEqual(rotated);
		expect(lastDmTo(JANE.slack).text).toContain("no longer works");

		team1234 = rotated[0] as string;
		expect(await checkAccess(team1234, "gate")).toMatchObject({ valid: true, grant: "team" });

		// Everyone was told, so signing in again sends nothing new.
		const before = dmsTo(JANE.slack).length;
		jane = await signIn(JANE.slack, JANE.name, JANE.email);
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(before);
	});

	it("rotating a personal link kills the old one and DMs its owner", async () => {
		const result = await admin.rotatePersonalAccessLink(janeId);
		expect(result).toMatchObject({ notified: 1, failed: 0 });

		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: false, reason: "unknown_token" });
		const [fresh] = tokensIn(lastDmTo(JANE.slack).text);
		expect(fresh).toBeDefined();
		expect(await checkAccess(fresh as string, "gate")).toMatchObject({ valid: true, grant: "personal" });
		janePersonal = fresh as string;
	});

	it("blocking a shared account deletes its personal link but leaves its team links alone", async () => {
		await admin.setPersonalAccessBlocked(janeId, true);

		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: false, reason: "unknown_token" });
		expect(await checkAccess(team1234, "gate")).toMatchObject({ valid: true });
		expect((await admin.listPersonalAccess())[janeId]?.status).toBe("blocked");
		await expect(admin.revealPersonalAccessLink(janeId)).rejects.toThrow(/blocked/);

		// A blocked account signing in gets nothing new.
		const before = dmsTo(JANE.slack).length;
		jane = await signIn(JANE.slack, JANE.name, JANE.email);
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(before);
	});

	it("unblocking issues a fresh personal link at the next sign-in, never the old one", async () => {
		await admin.setPersonalAccessBlocked(janeId, false);
		expect((await admin.listPersonalAccess())[janeId]?.status).toBe("not_issued");

		const before = dmsTo(JANE.slack).length;
		jane = await signIn(JANE.slack, JANE.name, JANE.email);
		await vi.waitFor(() => expect(dmsTo(JANE.slack)).toHaveLength(before + 1));

		const tokens = tokensIn(lastDmTo(JANE.slack).text);
		expect(tokens).toHaveLength(1); // team links were already delivered
		expect(tokens[0]).not.toBe(janePersonal);
		janePersonal = tokens[0] as string;
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: true, grant: "personal" });
	});

	it("shuts personal links overnight", async () => {
		vi.setSystemTime(new Date("2026-05-25T06:30:00Z")); // 11:30pm PDT
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({
			valid: false,
			reason: "outside_window",
			window_starts_at: "2026-05-25T15:00:00.000Z",
		});
		vi.setSystemTime(new Date("2026-05-25T18:00:00Z"));
	});

	it("revokes a personal link as soon as its owner's Slack name stops parsing", async () => {
		jane = await signIn(JANE.slack, "Jane", JANE.email);
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: false, reason: "revoked" });

		jane = await signIn(JANE.slack, JANE.name, JANE.email);
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: true });
	});

	it("keeps link administration admin-only", async () => {
		await expect(jane.revealTeamAccessLink(1234)).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.rotatePersonalAccessLink(bobId)).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.setPersonalAccessBlocked(bobId, true)).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.listPersonalAccess()).rejects.toBeInstanceOf(PermissionError);
	});

	it("persists both link stores in this season's data folder", async () => {
		await settle();
		const season = join(dataDir, "2026");
		expect(existsSync(join(season, "teamAccess.json"))).toBe(true);

		const personal = JSON.parse(readFileSync(join(season, "personalAccess.json"), "utf-8")) as { token: string }[];
		expect(personal.map(p => p.token)).toContain(janePersonal);
		expect(personal).toHaveLength(3); // Ada, Jane, Bob

		const teams = JSON.parse(readFileSync(join(season, "teamAccess.json"), "utf-8")) as { token: string }[];
		expect(teams.map(t => t.token).sort()).toEqual([team1234, team5678].sort());

		const users = JSON.parse(readFileSync(join(dataDir, "users.json"), "utf-8")) as Record<string, unknown>[];
		expect(users.some(u => "accessToken" in u)).toBe(false);
	});
});
