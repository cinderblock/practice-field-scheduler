/**
 * Blackouts persisted before they gained ids and date ranges must keep working.
 *
 * A legacy record is written to disk, the backend is imported against it, and the loaded result is
 * checked for a backfilled id that also got written back to the file (so it survives a restart).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Blackout } from "~/types";

const year = new Date().getFullYear().toString();

let dataDir: string;
let blackoutsFile: string;
let loaded: Blackout[];

// Exactly the shape blackouts had before this feature: no id, no endDate, slot required
const legacyRecord = {
	date: `${year}-06-15`,
	slot: "10:00am",
	created: "2026-01-02T03:04:05.000Z",
	userId: "legacy-user",
	reason: "Legacy closure",
};

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "pfs-migration-"));
	mkdirSync(join(dataDir, year), { recursive: true });

	blackoutsFile = join(dataDir, year, "blackouts.json");
	writeFileSync(blackoutsFile, JSON.stringify([legacyRecord], null, 2), "utf-8");

	process.env.DATA_DIR = dataDir;

	const { Context } = await import("~/server/backend");
	const ctx = new Context(
		{
			user: { id: "admin", name: "Admin", email: "admin@example.test", image: "" },
			expires: new Date(Date.now() + 60_000).toISOString(),
		} as unknown as Session,
		"vitest",
		"127.0.0.1",
	);

	loaded = await ctx.getBlackouts();
});

afterAll(() => {
	rmSync(dataDir, { recursive: true, force: true });
});

describe("legacy blackout migration", () => {
	it("keeps the legacy record", () => {
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.date).toBe(legacyRecord.date);
		expect(loaded[0]?.slot).toBe(legacyRecord.slot);
		expect(loaded[0]?.reason).toBe(legacyRecord.reason);
	});

	it("backfills an id so the record can be removed", () => {
		expect(loaded[0]?.id).toBeTruthy();
	});

	it("treats a record with no endDate as a single day", () => {
		expect(loaded[0]?.endDate).toBeUndefined();
	});

	it("revives the stored timestamp as a Date", () => {
		expect(loaded[0]?.created).toBeInstanceOf(Date);
		expect(loaded[0]?.created.toISOString()).toBe(legacyRecord.created);
	});

	it("writes the backfilled id back to disk so it survives a restart", () => {
		const onDisk = JSON.parse(readFileSync(blackoutsFile, "utf-8")) as Blackout[];
		expect(onDisk[0]?.id).toBe(loaded[0]?.id);
	});
});
