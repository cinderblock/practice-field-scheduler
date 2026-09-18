/**
 * The Slack mapping store, after a year of sign-ins that stored a random UUID
 * as the "Slack id" (Auth.js mints one per OAuth sign-in; see the `jwt`
 * callback in auth/config.ts):
 *
 * - at startup, mappings that aren't Slack user ids are dropped and the file
 *   written back;
 * - a session still carrying such a UUID is identified by the email on the
 *   person's Slack profile, once per session, and the real id stored;
 * - someone Slack can't find by email is still served -- unidentified, with
 *   their links waiting -- and no mapping is written for them.
 *
 * Kept apart from the end-to-end suite because it needs the data files in
 * place before the backend module loads. Slack is simulated at `fetch`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "pfs-slack-mappings-"));
process.env.DATA_DIR = dataDir;

const JANE_SLACK = "U0JANE";
const BOB_SLACK = "U0BOB";
const janeProfile = { real_name: "Jane Doe", display_name: "Jane Doe (1234)" };

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
	const method = url.split("/").pop();
	const params = new URLSearchParams(init?.body as string);
	if (method === "users.lookupByEmail") {
		return params.get("email") === "jane@example.com"
			? Response.json({ ok: true, user: { id: JANE_SLACK, profile: janeProfile } })
			: Response.json({ ok: false, error: "users_not_found" });
	}
	if (method === "users.info") {
		return params.get("user") === JANE_SLACK
			? Response.json({ ok: true, user: { id: JANE_SLACK, profile: janeProfile } })
			: Response.json({ ok: false, error: "user_not_found" });
	}
	return Response.json({ ok: true, channel: "D1", ts: "1" });
});
vi.stubGlobal("fetch", fetchMock);

const created = "2026-01-10T00:00:00.000Z";
writeFileSync(
	join(dataDir, "users.json"),
	JSON.stringify([
		{ id: "jane-uid", name: "Jane Doe", created, updated: created, teams: [], email: "jane@example.com", image: "" },
		{ id: "bob-uid", name: "Bob Roe", created, updated: created, teams: [1234], email: "bob@example.com", image: "" },
	]),
);
// Two stale UUIDs for Jane, one for Bob, and Bob's real id: what production looked like.
writeFileSync(
	join(dataDir, "slack.json"),
	JSON.stringify([
		{ slackId: "72e3ac22-cbb7-4638-a444-c8b8374d99b1", userId: "jane-uid" },
		{ slackId: "0c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5", userId: "jane-uid" },
		{ slackId: BOB_SLACK, userId: "bob-uid" },
		{ slackId: "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a", userId: "bob-uid" },
	]),
);
mkdirSync(join(dataDir, new Date().getFullYear().toString()));

const { Context } = await import("~/server/backend");

afterAll(() => {
	vi.unstubAllGlobals();
	rmSync(dataDir, { recursive: true, force: true });
});

const mappings = () =>
	JSON.parse(readFileSync(join(dataDir, "slack.json"), "utf-8")) as { slackId: string; userId: string }[];

function session(id: string, name: string, email: string): Session {
	return { user: { id, name, email, image: "" }, expires: "2099-01-01T00:00:00.000Z" };
}

const lookups = () => fetchMock.mock.calls.filter(([url]) => url.endsWith("/users.lookupByEmail")).length;

describe("Slack mappings", () => {
	it("drops the entries that aren't Slack user ids at startup, and writes the file back", async () => {
		// A real-id session; resolving it proves initialization (and the prune) has finished.
		const bob = new Context(session(BOB_SLACK, "Bob Roe", "bob@example.com"), "vitest", "127.0.0.1");
		expect(await bob.getTeams()).toEqual([1234]);
		expect(await bob.getSlackUserId()).toBe(BOB_SLACK);
		expect(mappings()).toEqual([{ slackId: BOB_SLACK, userId: "bob-uid" }]);
		expect(lookups()).toBe(0);
	});

	it("identifies a stale UUID session by email, stores the real id, and reads their names", async () => {
		const stale = session("3b2a1c0d-1234-4abc-9def-0123456789ab", "Jane Doe", "jane@example.com");
		const jane = new Context(stale, "vitest", "127.0.0.1");
		// Teams now come from her Slack display name, read on this first request.
		expect(await jane.getTeams()).toEqual([1234]);
		expect(await jane.getSlackUserId()).toBe(JANE_SLACK);
		expect(await jane.getMySlackNames()).toMatchObject({ identified: true, ok: true, displayName: "Jane Doe (1234)" });

		await vi.waitFor(() => expect(mappings()).toContainEqual({ slackId: JANE_SLACK, userId: "jane-uid" }));
		expect(mappings().filter(m => m.userId === "jane-uid")).toHaveLength(1);
	});

	it("asks Slack once per session, not once per request", async () => {
		const before = lookups();
		const stale = session("3b2a1c0d-1234-4abc-9def-0123456789ab", "Jane Doe", "jane@example.com");
		for (let i = 0; i < 3; i++) {
			const jane = new Context(stale, "vitest", "127.0.0.1");
			expect(await jane.getSlackUserId()).toBe(JANE_SLACK);
		}
		expect(lookups()).toBe(before);
	});

	it("still serves someone Slack can't find by email, unidentified, and stores no mapping for them", async () => {
		const stale = session("6e5d4c3b-2222-4333-8444-fedcba987654", "Nobody New (4321)", "nobody@example.com");
		const nobody = new Context(stale, "vitest", "127.0.0.1");
		expect(await nobody.getTeams()).toEqual([4321]);
		expect(await nobody.getSlackUserId()).toBeNull();
		expect(await nobody.getMySlackNames()).toMatchObject({ identified: false, issues: ["unverified"] });

		await new Promise(resolve => setTimeout(resolve, 50));
		expect(mappings().filter(m => !/^U/.test(m.slackId))).toEqual([]);
	});
});
