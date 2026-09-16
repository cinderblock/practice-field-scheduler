/**
 * Startup clean-up of the personal link store. A personal link may only exist
 * for someone approved for general gate access, whatever state the files were
 * left in (links written before approval was required, or owners whose user
 * record has since expired).
 *
 * Kept apart from the end-to-end suite because it needs the data files in
 * place before the backend module loads.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "pfs-gate-startup-"));
process.env.DATA_DIR = dataDir;

vi.useFakeTimers({ toFake: ["Date"] });
// Saturday 11am PDT, inside site hours.
vi.setSystemTime(new Date("2026-05-23T18:00:00Z"));
vi.stubGlobal("fetch", vi.fn());

const created = "2026-01-10T00:00:00.000Z";
const user = (id: string, displayName: string, extra: Record<string, unknown>) => ({
	id,
	name: displayName.replace(/\s*\(.*\)$/, ""),
	displayName,
	created,
	updated: created,
	teams: [1234],
	email: `${id}@example.com`,
	image: "",
	...extra,
});
const link = (userId: string, token: string) => ({ userId, token, created });

const APPROVED = "a".repeat(32);
const UNAPPROVED = "b".repeat(32);
const DISABLED_APPROVED = "c".repeat(32);
const ORPHANED = "d".repeat(32);

writeFileSync(
	join(dataDir, "users.json"),
	JSON.stringify([
		user("approved", "Ada Approved (1234)", { generalAccessApproved: true }),
		user("unapproved", "Una Unapproved (1234)", {}),
		user("disabled", "Dee Disabled (1234)", { generalAccessApproved: true, disabled: true }),
	]),
);
mkdirSync(join(dataDir, "2026"));
writeFileSync(
	join(dataDir, "2026", "personalAccess.json"),
	JSON.stringify([
		link("approved", APPROVED),
		link("unapproved", UNAPPROVED),
		link("disabled", DISABLED_APPROVED),
		link("expired-user", ORPHANED),
	]),
);

const { checkAccess } = await import("~/server/backend");

afterAll(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	rmSync(dataDir, { recursive: true, force: true });
});

describe("personal link store at startup", () => {
	it("keeps an approved person's link working", async () => {
		expect(await checkAccess(APPROVED, "gate")).toMatchObject({ valid: true, grant: "personal" });
	});

	it("deletes links whose owner isn't approved, or no longer exists", async () => {
		for (const token of [UNAPPROVED, ORPHANED]) {
			expect(await checkAccess(token, "gate")).toMatchObject({ valid: false, reason: "unknown_token" });
		}
	});

	it("keeps a disabled but approved person's link, which stays shut until they're re-enabled", async () => {
		expect(await checkAccess(DISABLED_APPROVED, "gate")).toMatchObject({
			valid: false,
			grant: "personal",
			reason: "revoked",
		});
	});

	it("writes the clean-up back to disk", async () => {
		const stored = JSON.parse(readFileSync(join(dataDir, "2026", "personalAccess.json"), "utf-8")) as {
			token: string;
		}[];
		expect(stored.map(p => p.token).sort()).toEqual([APPROVED, DISABLED_APPROVED].sort());
	});
});
