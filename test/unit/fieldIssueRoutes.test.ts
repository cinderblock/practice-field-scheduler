/**
 * The two field-issue route handlers: photo upload and snapshot download. The backend is
 * mocked; what's under test is the HTTP shape: statuses, headers, and that nothing odd in
 * a URL or body gets past them.
 */

import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ctxState, mocks } = vi.hoisted(() => {
	class PermissionError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "PermissionError";
		}
	}
	class InvalidRequestError extends Error {
		constructor(
			message: string,
			public readonly status: 400 | 404 | 413 | 415 = 400,
		) {
			super(message);
			this.name = "InvalidRequestError";
		}
	}
	const mocks = {
		attachFieldIssuePhoto: vi.fn(),
		readFieldIssueSnapshot: vi.fn(),
		recordServerError: vi.fn(async () => undefined),
		PermissionError,
		InvalidRequestError,
	};
	return { ctxState: { signedIn: true }, mocks };
});

vi.mock("~/server/backend", () => ({
	PermissionError: mocks.PermissionError,
	InvalidRequestError: mocks.InvalidRequestError,
}));

vi.mock("~/server/requestContext", () => ({
	contextFromRequest: vi.fn(async () =>
		ctxState.signedIn
			? {
					attachFieldIssuePhoto: mocks.attachFieldIssuePhoto,
					readFieldIssueSnapshot: mocks.readFieldIssueSnapshot,
					recordServerError: mocks.recordServerError,
				}
			: null,
	),
}));

const { POST } = await import("~/app/api/issues/[id]/photos/route");
const { GET } = await import("~/app/api/issues/[id]/snapshots/[file]/route");

const ID = "6f1d1a2e-3b4c-4d5e-8f90-1a2b3c4d5e6f";
const FILE = "0f1d1a2e-3b4c-4d5e-8f90-1a2b3c4d5e6f-camera.jpg";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function params<T>(value: T) {
	return { params: Promise.resolve(value) };
}

function upload(id: string, body: BodyInit | null, headers: Record<string, string> = {}): NextRequest {
	return new Request(`http://localhost/api/issues/${id}/photos`, { method: "POST", body, headers }) as never;
}

function photoForm(bytes: Uint8Array = JPEG): FormData {
	const form = new FormData();
	form.append("photo", new Blob([bytes], { type: "image/jpeg" }), "field.jpg");
	return form;
}

beforeEach(() => {
	ctxState.signedIn = true;
	mocks.attachFieldIssuePhoto.mockReset();
	mocks.readFieldIssueSnapshot.mockReset();
	mocks.recordServerError.mockClear();
});

describe("POST /api/issues/[id]/photos", () => {
	it("stores the photo and answers with the snapshot", async () => {
		mocks.attachFieldIssuePhoto.mockResolvedValue({ id: "s1", source: "device", file: "s1-device.jpg" });
		const res = await POST(upload(ID, photoForm()), params({ id: ID }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ snapshot: { id: "s1", source: "device", file: "s1-device.jpg" } });

		const [id, bytes] = mocks.attachFieldIssuePhoto.mock.calls[0] as [string, Buffer];
		expect(id).toBe(ID);
		expect(Buffer.isBuffer(bytes)).toBe(true);
		expect(bytes.equals(Buffer.from(JPEG))).toBe(true);
	});

	it("wants a signed-in user", async () => {
		ctxState.signedIn = false;
		const res = await POST(upload(ID, photoForm()), params({ id: ID }));
		expect(res.status).toBe(401);
		expect(mocks.attachFieldIssuePhoto).not.toHaveBeenCalled();
	});

	it("rejects an id that isn't one of ours before doing anything", async () => {
		const res = await POST(upload("..", photoForm()), params({ id: ".." }));
		expect(res.status).toBe(400);
		expect(mocks.attachFieldIssuePhoto).not.toHaveBeenCalled();
	});

	it("refuses a body the browser declares too big without reading it", async () => {
		const res = await POST(upload(ID, photoForm(), { "content-length": String(50 * 1024 * 1024) }), params({ id: ID }));
		expect(res.status).toBe(413);
		expect(mocks.attachFieldIssuePhoto).not.toHaveBeenCalled();
	});

	it("wants a multipart form with a photo in it", async () => {
		const noForm = await POST(upload(ID, "just text", { "content-type": "text/plain" }), params({ id: ID }));
		expect(noForm.status).toBe(400);

		const empty = new FormData();
		empty.append("notes", "no file here");
		const noPhoto = await POST(upload(ID, empty), params({ id: ID }));
		expect(noPhoto.status).toBe(400);
		expect(mocks.attachFieldIssuePhoto).not.toHaveBeenCalled();
	});

	it("maps the backend's refusals to statuses", async () => {
		mocks.attachFieldIssuePhoto.mockRejectedValueOnce(new mocks.PermissionError("not yours"));
		expect((await POST(upload(ID, photoForm()), params({ id: ID }))).status).toBe(403);

		mocks.attachFieldIssuePhoto.mockRejectedValueOnce(new mocks.InvalidRequestError("not an image", 415));
		const res = await POST(upload(ID, photoForm()), params({ id: ID }));
		expect(res.status).toBe(415);
		expect(await res.json()).toEqual({ error: "not an image" });

		mocks.attachFieldIssuePhoto.mockRejectedValueOnce(new mocks.InvalidRequestError("gone", 404));
		expect((await POST(upload(ID, photoForm()), params({ id: ID }))).status).toBe(404);
	});

	it("records an unexpected failure and answers 500", async () => {
		mocks.attachFieldIssuePhoto.mockRejectedValueOnce(new Error("disk full"));
		const res = await POST(upload(ID, photoForm()), params({ id: ID }));
		expect(res.status).toBe(500);
		expect(mocks.recordServerError).toHaveBeenCalledWith("fieldIssuePhoto", "disk full", { id: ID });
	});
});

describe("GET /api/issues/[id]/snapshots/[file]", () => {
	function get(id: string, file: string) {
		const req = new Request(`http://localhost/api/issues/${id}/snapshots/${file}`) as unknown as NextRequest;
		return GET(req, params({ id, file }));
	}

	it("serves the bytes with the stored content type, privately", async () => {
		mocks.readFieldIssueSnapshot.mockResolvedValue({
			bytes: Buffer.from(JPEG),
			contentType: "image/jpeg",
			snapshot: { file: FILE },
		});
		const res = await get(ID, FILE);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/jpeg");
		expect(res.headers.get("cache-control")).toMatch(/private/);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
		expect(mocks.readFieldIssueSnapshot).toHaveBeenCalledWith(ID, FILE);
	});

	it("is 404 for anything that isn't shaped like our files, without asking the backend", async () => {
		expect((await get(ID, "../users.json")).status).toBe(404);
		expect((await get(ID, "evil.jpg")).status).toBe(404);
		expect((await get("not-an-id", FILE)).status).toBe(404);
		expect(mocks.readFieldIssueSnapshot).not.toHaveBeenCalled();
	});

	it("wants a signed-in user", async () => {
		ctxState.signedIn = false;
		expect((await get(ID, FILE)).status).toBe(401);
	});

	it("is 404 when the report has no such file, and 403 for non-admins", async () => {
		mocks.readFieldIssueSnapshot.mockResolvedValueOnce(null);
		expect((await get(ID, FILE)).status).toBe(404);

		mocks.readFieldIssueSnapshot.mockRejectedValueOnce(new mocks.PermissionError("admins only"));
		expect((await get(ID, FILE)).status).toBe(403);
	});
});
