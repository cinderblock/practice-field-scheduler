/**
 * Field issue reports against the real backend, on a scratch DATA_DIR.
 *
 * Like blackoutEnforcement.test.ts: DATA_DIR is pointed at a temp directory and users are
 * seeded before the backend is imported. On top of that, the camera settings are put in
 * `process.env` before `~/env` is first evaluated, and the stubbed `fetch` answers Home
 * Assistant's camera proxy with a tiny JPEG (and Slack with "we don't know you").
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "next-auth";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context as ContextClass } from "~/server/backend";
import type { FieldIssue } from "~/types";

const YEAR = new Date().getFullYear().toString();
const Date1 = `${YEAR}-06-10`;
const Slot = "04:00pm";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

let dataDir: string;
let Context: typeof ContextClass;
let PermissionError: typeof import("~/server/backend").PermissionError;
let InvalidRequestError: typeof import("~/server/backend").InvalidRequestError;
let cameraRequests: string[] = [];

function session(id: string): Session {
	return {
		user: { id, name: id, email: `${id}@example.test`, image: "" },
		expires: new Date(Date.now() + 60_000).toISOString(),
	} as unknown as Session;
}

const admin = () => new Context(session("admin"), "vitest", "127.0.0.1");
const member = () => new Context(session("member"), "vitest", "127.0.0.1");
const stranger = () => new Context(session("stranger"), "vitest", "127.0.0.1");

/** A seeded user. Sessions here carry no Slack id, so the backend finds people by email. */
function user(sessionId: string, teams: number[] | "admin") {
	const now = new Date().toISOString();
	return {
		id: `${sessionId}-uid`,
		name: `${sessionId} user`,
		email: `${sessionId}@example.test`,
		teams,
		created: now,
		updated: now,
		image: "",
	};
}

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "pfs-issues-"));
	writeFileSync(
		join(dataDir, "users.json"),
		JSON.stringify([user("admin", "admin"), user("member", [1234]), user("stranger", [5678])]),
		"utf-8",
	);
	mkdirSync(join(dataDir, YEAR), { recursive: true });

	process.env.DATA_DIR = dataDir;
	process.env.HOME_ASSISTANT_URL = "http://ha.test:8123";
	process.env.HOME_ASSISTANT_TOKEN = "a-long-lived-token-of-some-length";
	process.env.FIELD_CAMERAS = "Field=camera.field_centered, Rollup=camera.south_rollup";

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = String(input instanceof Request ? input.url : input);
			if (url.includes("/api/camera_proxy/")) {
				cameraRequests.push(url);
				// One camera works, the other is down
				if (url.endsWith("camera.south_rollup")) return new Response("down", { status: 503, statusText: "Down" });
				return new Response(new Uint8Array(JPEG), { status: 200, headers: { "content-type": "image/jpeg" } });
			}
			return Response.json({ ok: false, error: "invalid_auth" });
		}),
	);

	const backend = await import("~/server/backend");
	Context = backend.Context;
	PermissionError = backend.PermissionError;
	InvalidRequestError = backend.InvalidRequestError;
});

afterAll(() => {
	vi.unstubAllGlobals();
	rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
	cameraRequests = [];
	vi.restoreAllMocks();
});

function file(issue: FieldIssue, index = 0) {
	const snapshot = issue.snapshots[index];
	if (!snapshot) throw new Error(`No snapshot ${index}`);
	return join(dataDir, YEAR, "issues", issue.id, snapshot.file);
}

describe("filing a report", () => {
	it("lets a team member file one, with a frame from each camera that answered", async () => {
		const { issue, cameras } = await member().addFieldIssue({
			kind: "not_reset",
			date: Date1,
			slot: Slot,
			team: "1234",
			notes: "  Balls everywhere  ",
		});

		expect(issue.kind).toBe("not_reset");
		expect(issue.userId).toBe("member-uid");
		expect(issue.team).toBe("1234");
		expect(issue.notes).toBe("Balls everywhere");
		expect(issue.resolved).toBeUndefined();

		expect(cameraRequests).toHaveLength(2);
		expect(cameras).toEqual([
			{ camera: "Field", ok: true },
			{ camera: "Rollup", ok: false, error: expect.stringContaining("503") },
		]);

		expect(issue.snapshots).toHaveLength(1);
		const [snapshot] = issue.snapshots;
		expect(snapshot).toMatchObject({
			source: "camera",
			camera: "Field",
			contentType: "image/jpeg",
			bytes: JPEG.length,
		});
		expect(snapshot?.file).toMatch(/-camera\.jpg$/);
		expect(readFileSync(file(issue)).equals(JPEG)).toBe(true);

		// Persisted, not just in memory
		const onDisk = JSON.parse(readFileSync(join(dataDir, YEAR, "issues.json"), "utf-8")) as FieldIssue[];
		expect(onDisk.find(i => i.id === issue.id)?.snapshots).toHaveLength(1);
	});

	it("skips the cameras when asked to", async () => {
		const { issue, cameras } = await member().addFieldIssue({
			kind: "repair_made",
			date: Date1,
			slot: Slot,
			captureCameras: false,
		});
		expect(cameraRequests).toHaveLength(0);
		expect(cameras).toEqual([]);
		expect(issue.snapshots).toEqual([]);
		expect(issue.team).toBeUndefined();
	});

	it("insists on a note for 'other'", async () => {
		await expect(
			member().addFieldIssue({ kind: "other", date: Date1, slot: Slot, notes: "   ", captureCameras: false }),
		).rejects.toBeInstanceOf(InvalidRequestError);
	});

	it("needs someone signed in", async () => {
		const nobody = new Context(null as unknown as Session, "vitest", "127.0.0.1");
		await expect(nobody.addFieldIssue({ kind: "safety", date: Date1, slot: Slot })).rejects.toBeInstanceOf(
			PermissionError,
		);
	});
});

describe("reading the log", () => {
	it("is for admins only", async () => {
		await expect(member().listFieldIssues()).rejects.toBeInstanceOf(PermissionError);
	});

	it("lists reports newest first, as copies", async () => {
		const first = (await member().addFieldIssue({ kind: "safety", date: Date1, slot: Slot, captureCameras: false }))
			.issue;
		const second = (
			await member().addFieldIssue({ kind: "other", date: Date1, slot: Slot, notes: "x", captureCameras: false })
		).issue;

		const listed = await admin().listFieldIssues();
		const ids = listed.map(i => i.id);
		expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

		const mine = listed.find(i => i.id === first.id);
		if (!mine) throw new Error("missing");
		mine.notes = "tampered";
		mine.snapshots.push({} as never);
		const again = (await admin().listFieldIssues()).find(i => i.id === first.id);
		expect(again?.notes).toBeUndefined();
		expect(again?.snapshots).toEqual([]);
	});
});

describe("photos from the reporter's device", () => {
	async function fileOne(ctx = member()) {
		return (await ctx.addFieldIssue({ kind: "repair_needed", date: Date1, slot: Slot, captureCameras: false })).issue;
	}

	it("are stored next to the report and recorded on it", async () => {
		const issue = await fileOne();
		const snapshot = await member().attachFieldIssuePhoto(issue.id, PNG);

		expect(snapshot).toMatchObject({ source: "device", contentType: "image/png", bytes: PNG.length });
		expect(snapshot.camera).toBeUndefined();
		expect(snapshot.file).toMatch(/-device\.png$/);

		const listed = (await admin().listFieldIssues()).find(i => i.id === issue.id);
		expect(listed?.snapshots.map(s => s.id)).toEqual([snapshot.id]);
		expect(readFileSync(file(listed as FieldIssue)).equals(PNG)).toBe(true);
	});

	it("refuse anything that isn't an image, and anything too big", async () => {
		const issue = await fileOne();
		await expect(member().attachFieldIssuePhoto(issue.id, Buffer.from("<svg/>"))).rejects.toMatchObject({
			name: "InvalidRequestError",
			status: 415,
		});
		const huge = Buffer.alloc(8 * 1024 * 1024 + 1);
		JPEG.copy(huge);
		await expect(member().attachFieldIssuePhoto(issue.id, huge)).rejects.toMatchObject({ status: 413 });
	});

	it("may only be added by the reporter or an admin", async () => {
		const issue = await fileOne();
		await expect(stranger().attachFieldIssuePhoto(issue.id, JPEG)).rejects.toBeInstanceOf(PermissionError);
		await expect(admin().attachFieldIssuePhoto(issue.id, JPEG)).resolves.toMatchObject({ source: "device" });
	});

	it("can't be added by the reporter once the report is old", async () => {
		const issue = await fileOne();
		vi.spyOn(Date, "now").mockReturnValue(issue.created.getTime() + 2 * 60 * 60 * 1000);
		await expect(member().attachFieldIssuePhoto(issue.id, JPEG)).rejects.toThrow(/within an hour/);
	});

	it("are capped per report", async () => {
		const issue = await fileOne();
		for (let i = 0; i < 10; i++) await member().attachFieldIssuePhoto(issue.id, JPEG);
		await expect(member().attachFieldIssuePhoto(issue.id, JPEG)).rejects.toThrow(/at most 10/);
	});

	it("go nowhere for a report that doesn't exist", async () => {
		await expect(member().attachFieldIssuePhoto("00000000-0000-0000-0000-000000000000", JPEG)).rejects.toMatchObject({
			status: 404,
		});
	});
});

describe("resolving and removing", () => {
	async function fileOne() {
		return (await member().addFieldIssue({ kind: "safety", date: Date1, slot: Slot, captureCameras: false })).issue;
	}

	it("is for admins only", async () => {
		const issue = await fileOne();
		await expect(member().setFieldIssueResolved({ id: issue.id, resolved: true })).rejects.toBeInstanceOf(
			PermissionError,
		);
		await expect(member().removeFieldIssue({ id: issue.id })).rejects.toBeInstanceOf(PermissionError);
	});

	it("records who resolved it and what they did, and can be undone", async () => {
		const issue = await fileOne();
		const resolved = await admin().setFieldIssueResolved({ id: issue.id, resolved: true, resolution: " Taped it " });
		expect(resolved.resolved).toBeInstanceOf(Date);
		expect(resolved.resolvedBy).toBe("admin-uid");
		expect(resolved.resolution).toBe("Taped it");

		const reopened = await admin().setFieldIssueResolved({ id: issue.id, resolved: false });
		expect(reopened.resolved).toBeUndefined();
		expect(reopened.resolvedBy).toBeUndefined();
		expect(reopened.resolution).toBeUndefined();
	});

	it("hides a removed report and its snapshots, but leaves the files", async () => {
		const issue = (await member().addFieldIssue({ kind: "safety", date: Date1, slot: Slot })).issue;
		expect(issue.snapshots).toHaveLength(1);
		const path = file(issue);
		expect(existsSync(path)).toBe(true);

		await admin().removeFieldIssue({ id: issue.id });

		expect((await admin().listFieldIssues()).some(i => i.id === issue.id)).toBe(false);
		expect(await admin().readFieldIssueSnapshot(issue.id, issue.snapshots[0]?.file ?? "")).toBeNull();
		await expect(admin().removeFieldIssue({ id: issue.id })).rejects.toMatchObject({ status: 404 });
		expect(existsSync(path)).toBe(true);
	});
});

describe("reading a snapshot", () => {
	it("hands admins the bytes and refuses everyone else", async () => {
		const issue = (await member().addFieldIssue({ kind: "safety", date: Date1, slot: Slot })).issue;
		const snapshot = issue.snapshots[0];
		if (!snapshot) throw new Error("no camera frame");

		const found = await admin().readFieldIssueSnapshot(issue.id, snapshot.file);
		expect(found?.contentType).toBe("image/jpeg");
		expect(found?.bytes.equals(JPEG)).toBe(true);

		await expect(member().readFieldIssueSnapshot(issue.id, snapshot.file)).rejects.toBeInstanceOf(PermissionError);
	});

	it("knows nothing about files the report doesn't list", async () => {
		const issue = (await member().addFieldIssue({ kind: "safety", date: Date1, slot: Slot })).issue;
		expect(await admin().readFieldIssueSnapshot(issue.id, "../../users.json")).toBeNull();
		expect(await admin().readFieldIssueSnapshot(issue.id, "nope-camera.jpg")).toBeNull();
	});
});
