/**
 * End-to-end over the real backend: sign-ins and approvals issue and DM
 * links, the token index answers /api/access/check, admin actions (approve,
 * revoke, rotate) take effect immediately, and gate links wait on people's
 * Slack names.
 *
 * Runs against a throwaway DATA_DIR. Slack is simulated at `fetch`: a
 * directory answers `users.info` / `users.list`, and every `chat.postMessage`
 * is recorded as a DM. Only `Date` is faked, so the change lock still behaves.
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

type Person = { slack: string; real: string; display: string; email: string };

/** What Slack's Web API says about each account. Tests edit it. */
const directory = new Map<string, { real_name: string; display_name: string; deleted: boolean; email: string }>();
/** When set, Slack's user-reading methods fail with this error. */
let readFailure: string | null = null;

function setNames(person: Person, real = person.real, display = person.display, deleted = false) {
	directory.set(person.slack, { real_name: real, display_name: display, deleted, email: person.email });
}

const member = (id: string) => {
	const entry = directory.get(id);
	return entry && { id, deleted: entry.deleted, profile: entry };
};

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
	const method = url.split("/").pop();
	if (method === "users.info" || method === "users.list" || method === "users.lookupByEmail") {
		if (readFailure) return Response.json({ ok: false, error: readFailure });
		if (method === "users.lookupByEmail") {
			const email = new URLSearchParams(init?.body as string).get("email") ?? "";
			const id = [...directory.entries()].find(([, entry]) => entry.email && entry.email === email)?.[0];
			const user = id ? member(id) : undefined;
			return Response.json(user ? { ok: true, user } : { ok: false, error: "users_not_found" });
		}
		if (method === "users.list") {
			return Response.json({
				ok: true,
				members: [...directory.keys()].map(member),
				response_metadata: { next_cursor: "" },
			});
		}
		const id = new URLSearchParams(init?.body as string).get("user") ?? "";
		const user = member(id);
		return Response.json(user ? { ok: true, user } : { ok: false, error: "user_not_found" });
	}
	return Response.json({ ok: true, channel: "D1", ts: "1" });
});
vi.stubGlobal("fetch", fetchMock);

const { Context, checkAccess, PermissionError, syncSlackNames } = await import("~/server/backend");

afterAll(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	rmSync(dataDir, { recursive: true, force: true });
});

type Dm = { channel: string; text: string };

const dms = (): Dm[] =>
	fetchMock.mock.calls
		.filter(([url]) => url.endsWith("/chat.postMessage"))
		.map(([, init]) => JSON.parse(init?.body as string) as Dm);
const dmsTo = (slackId: string) => dms().filter(d => d.channel === slackId);
const lastDmTo = (slackId: string) => dmsTo(slackId).at(-1) as Dm;
const tokensIn = (text: string) => [...text.matchAll(/\/g\/([A-Za-z0-9_-]{32})/g)].map(m => m[1] as string);

/** Let fire-and-forget DM work finish, so "nothing was sent" is a real observation. */
const settle = () => new Promise(resolve => setTimeout(resolve, 100));

/** Sign in with Slack's OIDC profile, which has one `name` claim and no display name. */
function session(person: Person, oidcName: string): Session {
	return {
		user: { id: person.slack, name: oidcName, email: person.email, image: "" },
		expires: "2099-01-01T00:00:00.000Z",
	};
}

async function signIn(person: Person, oidcName = person.real) {
	const ctx = new Context(session(person, oidcName), "vitest", "127.0.0.1");
	await ctx.getTeams(); // resolves (and creates/syncs) the user
	return ctx;
}

const ADA: Person = { slack: "U_ADA", real: "Ada Admin", display: "Ada Admin (TSL)", email: "ada@example.com" };
const JANE: Person = { slack: "U_JANE", real: "Jane Doe", display: "Jane Doe (1234, 5678)", email: "jane@example.com" };
const BOB: Person = { slack: "U_BOB", real: "Bob Roe", display: "Bob Roe (1234)", email: "bob@example.com" };
const LAPTOP: Person = {
	slack: "U_LAPTOP",
	real: "Robotics Laptop",
	display: "Robotics Laptop",
	email: "laptop@example.com",
};
/** In the workspace, but never signs in to the scheduler. */
const STRANGER: Person = { slack: "U_STRANGER", real: "Stranger 42", display: "", email: "" };
const NIA: Person = { slack: "U_NIA", real: "Nia New", display: "Nia New (5678)", email: "nia@example.com" };

for (const person of [ADA, JANE, BOB, LAPTOP, STRANGER]) setNames(person);

// Shared across the sequential steps below.
let admin: InstanceType<typeof Context>;
let jane: InstanceType<typeof Context>;
let adaId: string;
let janeId: string;
let bobId: string;
let janePersonal: string;
let bobPersonal: string;
let team1234: string;
let team5678: string;

async function idOf(displayName: string): Promise<string> {
	const users = await admin.getUsers();
	return users.find(u => u.displayName === displayName)?.id as string;
}

describe("gate access, end to end", () => {
	it("gives nobody general gate access by default — not even the first admin", async () => {
		admin = await signIn(ADA);
		expect(await admin.getTeams()).toBe("admin");
		adaId = await idOf(ADA.display);

		await settle();
		expect(dmsTo(ADA.slack)).toHaveLength(0); // no teams, not approved, names fine: nothing to send
		expect((await admin.listPersonalAccess())[adaId]).toMatchObject({ status: "not_approved", nameIssues: [] });
		await expect(admin.revealPersonalAccessLink(adaId)).rejects.toThrow(/isn't approved/);
	});

	it("approving someone issues their personal link and DMs it straight away", async () => {
		const result = await admin.setGeneralAccessApproved(adaId, true);
		expect(result).toMatchObject({ approved: true, linkIssued: true, notified: 1, failed: 0, skipped: null });

		expect(dmsTo(ADA.slack)).toHaveLength(1);
		expect(lastDmTo(ADA.slack).text).toContain("approved for general gate access");
		const tokens = tokensIn(lastDmTo(ADA.slack).text);
		expect(tokens).toHaveLength(1);

		expect(await checkAccess(tokens[0] as string, "gate")).toMatchObject({
			valid: true,
			grant: "personal",
			user: { name: ADA.display },
		});
		expect((await admin.listPersonalAccess())[adaId]?.status).toBe("active");
	});

	it("takes a newcomer's teams from their Slack display name, and sends both team links", async () => {
		jane = await signIn(JANE);
		expect(await jane.getTeams()).toEqual([1234, 5678]);
		janeId = await idOf(JANE.display);

		await vi.waitFor(() => expect(dmsTo(JANE.slack)).toHaveLength(1));
		const tokens = tokensIn(lastDmTo(JANE.slack).text);
		expect(tokens).toHaveLength(2);

		for (const t of tokens) {
			// No reservations yet, so the team links are shut.
			expect(await checkAccess(t, "gate")).toMatchObject({ valid: false, grant: "team", reason: "outside_window" });
		}

		expect((await admin.listTeamAccess()).map(t => String(t.team))).toEqual(["1234", "5678"]);
		// Reveal tells us which shared token belongs to which team.
		team1234 = (await admin.revealTeamAccessLink(1234)).token;
		team5678 = (await admin.revealTeamAccessLink(5678)).token;
		expect(tokens.sort()).toEqual([team1234, team5678].sort());

		expect((await admin.listPersonalAccess())[janeId]?.status).toBe("not_approved");
	});

	it("approving that mentor DMs just the personal link", async () => {
		await admin.setGeneralAccessApproved(janeId, true);
		expect(dmsTo(JANE.slack)).toHaveLength(2);

		const tokens = tokensIn(lastDmTo(JANE.slack).text);
		expect(tokens).toHaveLength(1);
		janePersonal = tokens[0] as string;
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({
			valid: true,
			grant: "personal",
			team: null,
			reservation_id: null,
		});
	});

	it("doesn't re-send links on a later sign-in, and ignores the sign-in name once Slack has spoken", async () => {
		jane = await signIn(JANE, "Somebody Else (9999)");
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(2);
		expect(await jane.getTeams()).toEqual([1234, 5678]);
		expect(await jane.getName()).toBe(JANE.real);
	});

	it("gives a teammate the same shared team link, and their own personal link once approved", async () => {
		await signIn(BOB);
		await vi.waitFor(() => expect(dmsTo(BOB.slack)).toHaveLength(1));
		expect(tokensIn(lastDmTo(BOB.slack).text)).toEqual([team1234]);

		bobId = await idOf(BOB.display);
		await admin.setGeneralAccessApproved(bobId, true);
		[bobPersonal] = tokensIn(lastDmTo(BOB.slack).text) as [string];
		expect(bobPersonal).not.toBe(janePersonal);
		expect((await admin.revealPersonalAccessLink(bobId)).token).toBe(bobPersonal);
	});

	it("opens a team link around a reservation, and tells the rest of the team", async () => {
		const janeBefore = dmsTo(JANE.slack).length;
		// Book tomorrow (a date-only string is UTC midnight, so "today" can read as
		// the past on a machine west of UTC), then move the clock into the window.
		const reservation = await jane.addReservation({
			date: "2026-05-24",
			slot: "10:00am",
			team: 1234,
			priority: false,
		});
		await vi.waitFor(() => expect(dmsTo(BOB.slack)).toHaveLength(3));
		expect(lastDmTo(BOB.slack).text).toContain(`/g/${team1234}`);
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(janeBefore); // the creator isn't told about their own booking

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
		expect(result).toMatchObject({ notified: 2, failed: 0, held: 0 });

		expect(await checkAccess(team1234, "gate")).toMatchObject({ valid: false, reason: "unknown_token" });

		const rotated = tokensIn(lastDmTo(BOB.slack).text);
		expect(rotated).toHaveLength(1);
		expect(tokensIn(lastDmTo(JANE.slack).text)).toEqual(rotated);
		expect(lastDmTo(JANE.slack).text).toContain("no longer works");

		team1234 = rotated[0] as string;
		expect(await checkAccess(team1234, "gate")).toMatchObject({ valid: true, grant: "team" });

		// Everyone was told, so signing in again sends nothing new.
		const before = dmsTo(JANE.slack).length;
		jane = await signIn(JANE);
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(before);
	});

	it("rotating a personal link kills the old one and DMs its owner", async () => {
		const result = await admin.rotatePersonalAccessLink(janeId);
		expect(result).toMatchObject({ notified: 1, failed: 0, skipped: null });

		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: false, reason: "unknown_token" });
		const [fresh] = tokensIn(lastDmTo(JANE.slack).text);
		expect(fresh).toBeDefined();
		expect(await checkAccess(fresh as string, "gate")).toMatchObject({ valid: true, grant: "personal" });
		janePersonal = fresh as string;
	});

	it("revoking general gate access deletes the personal link but leaves team links alone", async () => {
		const result = await admin.setGeneralAccessApproved(janeId, false);
		expect(result).toMatchObject({ approved: false, linkIssued: false });

		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: false, reason: "unknown_token" });
		expect(await checkAccess(team1234, "gate")).toMatchObject({ valid: true });
		expect((await admin.listPersonalAccess())[janeId]?.status).toBe("not_approved");
		await expect(admin.revealPersonalAccessLink(janeId)).rejects.toThrow(/isn't approved/);

		// Signing in doesn't bring it back.
		const before = dmsTo(JANE.slack).length;
		jane = await signIn(JANE);
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(before);
	});

	it("re-approving issues a fresh personal link straight away, never the old one", async () => {
		const before = dmsTo(JANE.slack).length;
		await admin.setGeneralAccessApproved(janeId, true);
		expect(dmsTo(JANE.slack)).toHaveLength(before + 1);

		const tokens = tokensIn(lastDmTo(JANE.slack).text);
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).not.toBe(janePersonal);
		janePersonal = tokens[0] as string;
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: true, grant: "personal" });
	});

	it("tells a newcomer with wrong names what to fix, once, and issues nothing even when approved", async () => {
		const laptop = await signIn(LAPTOP);
		expect(await laptop.getTeams()).toEqual([]);
		const laptopId = await idOf(LAPTOP.display);

		await vi.waitFor(() => expect(dmsTo(LAPTOP.slack)).toHaveLength(1));
		const nudge = lastDmTo(LAPTOP.slack).text;
		expect(nudge).toContain("on hold");
		expect(nudge).toContain("Display name doesn't end with team number(s) in parentheses (now `Robotics Laptop`)");
		expect(tokensIn(nudge)).toEqual([]);

		const result = await admin.setGeneralAccessApproved(laptopId, true);
		expect(result).toMatchObject({ approved: true, linkIssued: false, notified: 0 });
		expect((await admin.listPersonalAccess())[laptopId]).toMatchObject({
			status: "invalid_name",
			nameIssues: ["display_name_no_affiliation"],
		});
		await expect(admin.revealPersonalAccessLink(laptopId)).rejects.toThrow(/Slack names need fixing/);

		// Same wrong names, so no second DM.
		await signIn(LAPTOP);
		await settle();
		expect(dmsTo(LAPTOP.slack)).toHaveLength(1);

		// Revoke again so it doesn't linger.
		await admin.setGeneralAccessApproved(laptopId, false);
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

	it("holds someone's links as soon as their display name loses its team, and tells them once", async () => {
		const before = dmsTo(JANE.slack).length;
		setNames(JANE, JANE.real, "Jane");
		await syncSlackNames();

		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: false, reason: "revoked" });
		expect((await admin.listPersonalAccess())[janeId]).toMatchObject({
			status: "invalid_name",
			nameIssues: ["display_name_no_affiliation"],
		});
		// Booking still works: teams stay as they were.
		expect(await jane.getTeams()).toEqual([1234, 5678]);

		await vi.waitFor(() => expect(dmsTo(JANE.slack)).toHaveLength(before + 1));
		expect(lastDmTo(JANE.slack).text).toContain("on hold");
		await syncSlackNames();
		await settle();
		expect(dmsTo(JANE.slack)).toHaveLength(before + 1);
	});

	it("leaves the link out of reservation notices and rotations while names are wrong", async () => {
		const bob = await signIn(BOB);
		let before = dmsTo(JANE.slack).length;
		await bob.addReservation({ date: "2026-05-26", slot: "10:00am", team: 1234, priority: false });
		await vi.waitFor(() => expect(dmsTo(JANE.slack)).toHaveLength(before + 1));
		expect(lastDmTo(JANE.slack).text).toContain("Team 1234");
		expect(tokensIn(lastDmTo(JANE.slack).text)).toEqual([]);

		before = dmsTo(JANE.slack).length;
		const result = await admin.rotateTeamAccessLink(1234);
		expect(result).toMatchObject({ notified: 1, held: 1 });
		expect(dmsTo(JANE.slack)).toHaveLength(before);
		team1234 = tokensIn(lastDmTo(BOB.slack).text)[0] as string;
	});

	it("sends the held links as soon as the names are fixed", async () => {
		const before = dmsTo(JANE.slack).length;
		setNames(JANE);
		await syncSlackNames();

		await vi.waitFor(() => expect(dmsTo(JANE.slack)).toHaveLength(before + 1));
		// Only what she hasn't had: the team link rotated while she was on hold.
		expect(tokensIn(lastDmTo(JANE.slack).text)).toEqual([team1234]);
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: true, grant: "personal" });
		expect((await admin.listPersonalAccess())[janeId]).toMatchObject({ status: "active", nameIssues: [] });
	});

	it("holds links while the full name carries team numbers, and suggests the fix", async () => {
		setNames(BOB, "Bob Roe (1234)");
		await syncSlackNames();

		expect(await checkAccess(bobPersonal, "gate")).toMatchObject({ valid: false, reason: "revoked" });
		await vi.waitFor(() => expect(lastDmTo(BOB.slack).text).toContain("on hold"));
		expect(lastDmTo(BOB.slack).text).toContain("• Full name: `Bob Roe`");

		const report = await admin.getSlackNameReport();
		expect(report.problems.find(p => p.slackId === BOB.slack)).toMatchObject({
			userId: bobId,
			issues: ["full_name_not_just_a_name"],
			suggestion: { realName: "Bob Roe", displayName: null },
		});

		setNames(BOB);
		await syncSlackNames();
		expect(await checkAccess(bobPersonal, "gate")).toMatchObject({ valid: true });
	});

	it("holds the links of a deactivated Slack account", async () => {
		setNames(BOB, BOB.real, BOB.display, true);
		await syncSlackNames();
		expect(await checkAccess(bobPersonal, "gate")).toMatchObject({ valid: false, reason: "revoked" });
		expect((await admin.listPersonalAccess())[bobId]).toMatchObject({
			status: "invalid_name",
			nameIssues: ["unverified"],
		});

		const before = dmsTo(BOB.slack).length;
		setNames(BOB);
		await syncSlackNames();
		expect(await checkAccess(bobPersonal, "gate")).toMatchObject({ valid: true });
		await settle();
		expect(dmsTo(BOB.slack)).toHaveLength(before);
	});

	it("audits the whole workspace, including people who never signed in, and can DM them", async () => {
		const report = await admin.checkSlackNamesNow();
		expect(report).toMatchObject({ status: "ok", error: null, memberCount: 5 });
		expect(report.problems.map(p => [p.slackId, p.userId !== null])).toEqual([
			[LAPTOP.slack, true],
			[STRANGER.slack, false],
		]);
		expect(report.problems[1]).toMatchObject({
			realName: "Stranger 42",
			displayName: "",
			issues: ["full_name_not_just_a_name", "display_name_missing"],
			suggestion: { realName: "Stranger", displayName: "Stranger (42)" },
		});

		const dry = await admin.nudgeSlackNameProblems(true);
		expect(dry).toMatchObject({ dryRun: true, total: 2, succeeded: 2, failed: 0 });
		await settle();
		expect(dmsTo(STRANGER.slack)).toHaveLength(0);

		const sent = await admin.nudgeSlackNameProblems(false);
		expect(sent).toMatchObject({ dryRun: false, total: 2, succeeded: 2, failed: 0 });
		expect(dmsTo(STRANGER.slack)).toHaveLength(1);
		expect(lastDmTo(STRANGER.slack).text).not.toContain("on hold");
		expect(lastDmTo(STRANGER.slack).text).toContain("• Display name: `Stranger (42)`");
	});

	it("reports a Slack token without users:read, and keeps the last results", async () => {
		const checkedAt = (await admin.getSlackNameReport()).checkedAt;
		readFailure = "missing_scope";
		const report = await admin.checkSlackNamesNow();
		expect(report).toMatchObject({ status: "missing_scope", checkedAt, memberCount: 5 });
		expect(report.problems).toHaveLength(2);
		await expect(admin.nudgeSlackNameProblems(false)).rejects.toThrow(/haven't been read/);

		// Links already verified stay live.
		expect(await checkAccess(janePersonal, "gate")).toMatchObject({ valid: true });
	});

	it("lets a newcomer book with teams from their sign-in name when Slack can't be read, but holds their links", async () => {
		setNames(NIA);
		const nia = await signIn(NIA, "Nia New (5678)");
		expect(await nia.getTeams()).toEqual([5678]);
		const niaId = await idOf("Nia New (5678)").catch(() => undefined);
		expect(niaId).toBeUndefined(); // no display name known yet
		await settle();
		expect(dmsTo(NIA.slack)).toHaveLength(0);

		readFailure = null;
		expect((await admin.checkSlackNamesNow()).status).toBe("ok");
		// The first check sends nothing by itself; her next visit does.
		await settle();
		expect(dmsTo(NIA.slack)).toHaveLength(0);
		await signIn(NIA);
		await vi.waitFor(() => expect(dmsTo(NIA.slack)).toHaveLength(1));
		expect(tokensIn(lastDmTo(NIA.slack).text)).toEqual([team5678]);
	});

	it("identifies a session carrying Auth.js's random UUID instead of a Slack id by email, and stores the real id", async () => {
		// Every session issued before the jwt callback in auth/config.ts looks like this.
		const stale: Session = {
			user: { id: "5d1c0f2e-1111-4222-8333-444455556666", name: JANE.real, email: JANE.email, image: "" },
			expires: "2099-01-01T00:00:00.000Z",
		};
		const ctx = new Context(stale, "vitest", "127.0.0.1");
		expect(Array.isArray(await ctx.getTeams())).toBe(true);
		expect(await ctx.getSlackUserId()).toBe(JANE.slack);
		expect(await ctx.getMySlackNames()).toMatchObject({ identified: true, displayName: JANE.display });

		await settle();
		const mappings = JSON.parse(readFileSync(join(dataDir, "slack.json"), "utf-8")) as { slackId: string }[];
		expect(mappings.length).toBeGreaterThan(0);
		expect(mappings.filter(m => !m.slackId.startsWith("U_"))).toEqual([]);
	});

	it("still serves someone Slack can't find by email: they can book, and the notice says links are waiting", async () => {
		const uma: Session = {
			user: {
				id: "7a9b8c7d-2222-4333-8444-555566667777",
				name: "Uma Unknown (1234)",
				email: "uma@example.com",
				image: "",
			},
			expires: "2099-01-01T00:00:00.000Z",
		};
		const ctx = new Context(uma, "vitest", "127.0.0.1");
		// Teams from the sign-in name, as before Slack could be read
		expect(await ctx.getTeams()).toEqual([1234]);
		expect(await ctx.getSlackUserId()).toBeNull();
		expect(await ctx.getMySlackNames()).toMatchObject({ identified: false, ok: false, issues: ["unverified"] });

		const reservation = await ctx.addReservation({
			date: "2026-05-27",
			slot: "07:00pm",
			team: "1234",
			notes: "",
			priority: false,
		});
		expect(reservation.team).toBe("1234");

		await settle();
		// Nothing was DM'd into the void
		expect(dms().some(d => !d.channel)).toBe(false);
		const mappings = JSON.parse(readFileSync(join(dataDir, "slack.json"), "utf-8")) as { slackId: string }[];
		expect(mappings.filter(m => !m.slackId.startsWith("U_"))).toEqual([]);
	});

	it("lets someone with wrong Slack names book field time -- names only gate links", async () => {
		setNames(LAPTOP, "Robotics Laptop", "Robotics Laptop");
		await admin.checkSlackNamesNow();
		const laptop = await signIn(LAPTOP);
		expect((await laptop.getMySlackNames()).ok).toBe(false);

		const reservation = await laptop.addReservation({
			date: "2026-05-28",
			slot: "10:00am",
			team: "1234",
			notes: "",
			priority: false,
		});
		expect(reservation.date).toBe("2026-05-28");
	});

	it("keeps link and name administration admin-only", async () => {
		await expect(jane.revealTeamAccessLink(1234)).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.rotatePersonalAccessLink(bobId)).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.setGeneralAccessApproved(janeId, true)).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.listPersonalAccess()).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.getSlackNameReport()).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.checkSlackNamesNow()).rejects.toBeInstanceOf(PermissionError);
		await expect(jane.nudgeSlackNameProblems(true)).rejects.toBeInstanceOf(PermissionError);
	});

	it("persists approvals, Slack names and both link stores", async () => {
		await settle();
		const season = join(dataDir, "2026");

		const personal = JSON.parse(readFileSync(join(season, "personalAccess.json"), "utf-8")) as { token: string }[];
		expect(personal.map(p => p.token)).toEqual(expect.arrayContaining([janePersonal, bobPersonal]));
		expect(personal).toHaveLength(3); // Ada, Jane, Bob — never the laptop

		expect(existsSync(join(season, "teamAccess.json"))).toBe(true);
		const teams = JSON.parse(readFileSync(join(season, "teamAccess.json"), "utf-8")) as { token: string }[];
		expect(teams.map(t => t.token).sort()).toEqual([team1234, team5678].sort());

		const users = JSON.parse(readFileSync(join(dataDir, "users.json"), "utf-8")) as Record<string, unknown>[];
		const approved = users.filter(u => u.generalAccessApproved === true).map(u => u.displayName);
		expect(approved.sort()).toEqual([ADA.display, BOB.display, JANE.display].sort());
		// Everyone Slack could identify has verified names; Uma, unknown to Slack, is the one exception
		const unsynced = users.filter(u => typeof u.slackNamesSyncedAt !== "string").map(u => u.email);
		expect(unsynced).toEqual(["uma@example.com"]);
		const laptop = users.find(u => u.displayName === LAPTOP.display);
		expect(laptop?.slackNameNudgeSentFor).toBe(JSON.stringify([LAPTOP.real, LAPTOP.display]));
		expect(users.some(u => "accessToken" in u)).toBe(false);
	});
});
