import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = "test-scheduler-key-do-not-use-in-prod";

const { envState } = vi.hoisted(() => ({
	envState: { SCHEDULER_API_KEY: "test-scheduler-key-do-not-use-in-prod" as string | undefined },
}));

vi.mock("~/env", () => ({
	env: envState,
}));

vi.mock("~/server/backend", () => ({
	checkAccess: vi.fn(),
}));

const { POST } = await import("~/app/api/access/check/route");
const { checkAccess } = await import("~/server/backend");
const checkAccessMock = vi.mocked(checkAccess);

function makeRequest({ body, auth, rawBody }: { body?: unknown; auth?: string; rawBody?: string }): NextRequest {
	const headers = new Headers({ "content-type": "application/json" });
	if (auth) headers.set("authorization", auth);
	const init: RequestInit = { method: "POST", headers };
	if (rawBody !== undefined) init.body = rawBody;
	else if (body !== undefined) init.body = JSON.stringify(body);
	return new Request("http://localhost/api/access/check", init) as unknown as NextRequest;
}

describe("POST /api/access/check", () => {
	beforeEach(() => {
		envState.SCHEDULER_API_KEY = TEST_KEY;
		checkAccessMock.mockReset();
	});

	it("returns 503 when SCHEDULER_API_KEY is not configured", async () => {
		envState.SCHEDULER_API_KEY = undefined;
		const res = await POST(makeRequest({ body: { token: "x", tool: "gate" }, auth: `Bearer ${TEST_KEY}` }));
		expect(res.status).toBe(503);
		expect(checkAccessMock).not.toHaveBeenCalled();
	});

	it("returns 401 when the Authorization header is missing", async () => {
		const res = await POST(makeRequest({ body: { token: "x", tool: "gate" } }));
		expect(res.status).toBe(401);
		expect(checkAccessMock).not.toHaveBeenCalled();
	});

	it("returns 401 when the bearer token is wrong", async () => {
		const res = await POST(
			makeRequest({ body: { token: "x", tool: "gate" }, auth: "Bearer wrong-secret-12345678901234567890123" }),
		);
		expect(res.status).toBe(401);
	});

	it("returns 401 when the Authorization header is not a Bearer scheme", async () => {
		const res = await POST(makeRequest({ body: { token: "x", tool: "gate" }, auth: `Basic ${TEST_KEY}` }));
		expect(res.status).toBe(401);
	});

	it("returns 400 when the body is not valid JSON", async () => {
		const res = await POST(makeRequest({ rawBody: "not json", auth: `Bearer ${TEST_KEY}` }));
		expect(res.status).toBe(400);
	});

	it("returns 400 when the body is missing fields", async () => {
		const res = await POST(makeRequest({ body: { token: "x" }, auth: `Bearer ${TEST_KEY}` }));
		expect(res.status).toBe(400);
	});

	it("returns 200 and the checkAccess result on success", async () => {
		const payload = {
			valid: true,
			tool: "gate",
			user: { id: "user-1", name: "Jane Doe (1234)" },
			team: { id: "1234", name: "Team 1234" },
			reservation_id: "res-1",
			window_starts_at: "2026-05-23T16:30:00.000Z",
			window_ends_at: "2026-05-24T05:00:00.000Z",
		};
		checkAccessMock.mockResolvedValue(payload as Awaited<ReturnType<typeof checkAccess>>);
		const res = await POST(makeRequest({ body: { token: "tok", tool: "gate" }, auth: `Bearer ${TEST_KEY}` }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(payload);
		expect(checkAccessMock).toHaveBeenCalledWith("tok", "gate");
	});

	it("returns 200 with the denial payload when access is denied", async () => {
		const payload = {
			valid: false as const,
			reason: "unknown_token" as const,
			tool: "gate",
			user: null,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		};
		checkAccessMock.mockResolvedValue(payload);
		const res = await POST(makeRequest({ body: { token: "tok", tool: "gate" }, auth: `Bearer ${TEST_KEY}` }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(payload);
	});

	it("returns 500 when checkAccess throws", async () => {
		checkAccessMock.mockRejectedValue(new Error("boom"));
		const res = await POST(makeRequest({ body: { token: "tok", tool: "gate" }, auth: `Bearer ${TEST_KEY}` }));
		expect(res.status).toBe(500);
	});
});
