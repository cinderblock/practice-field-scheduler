/**
 * Capturing frames from Home Assistant. `~/env` is mocked so each test can decide what's
 * configured, and `fetch` is passed in so nothing goes over the network.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { envState } = vi.hoisted(() => ({
	envState: {
		HOME_ASSISTANT_URL: "http://ha.test:8123/" as string | undefined,
		HOME_ASSISTANT_TOKEN: "a-long-lived-token-of-some-length" as string | undefined,
		FIELD_CAMERAS: "Field=camera.field_centered, Rollup=camera.south_rollup" as string | undefined,
	},
}));

vi.mock("~/env", () => ({ env: envState }));

const cameras = await import("~/server/cameras");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function imageResponse(bytes: Uint8Array = JPEG): Response {
	return new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });
}

describe("captureFieldCameras", () => {
	beforeEach(() => {
		envState.HOME_ASSISTANT_URL = "http://ha.test:8123/";
		envState.HOME_ASSISTANT_TOKEN = "a-long-lived-token-of-some-length";
	});

	it("asks Home Assistant's camera proxy for each camera, with the token", async () => {
		const fetchMock = vi.fn(async () => imageResponse());
		const results = await cameras.captureFieldCameras(fetchMock as unknown as typeof fetch);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("http://ha.test:8123/api/camera_proxy/camera.field_centered");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer a-long-lived-token-of-some-length");

		expect(results.map(r => r.camera)).toEqual(["Field", "Rollup"]);
		for (const r of results) {
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.frame.contentType).toBe("image/jpeg");
				expect(r.frame.bytes.length).toBe(JPEG.length);
			}
		}
	});

	it("reports one camera's failure without losing the other", async () => {
		const fetchMock = vi.fn(async (url: string) =>
			url.includes("south_rollup") ? new Response("nope", { status: 404, statusText: "Not Found" }) : imageResponse(),
		);
		const results = await cameras.captureFieldCameras(fetchMock as unknown as typeof fetch);

		expect(results[0]).toMatchObject({ camera: "Field", ok: true });
		expect(results[1]).toMatchObject({ camera: "Rollup", ok: false, error: expect.stringContaining("404") });
	});

	it("treats a non-image answer as a failure", async () => {
		const fetchMock = vi.fn(async () => new Response("<html>login</html>", { status: 200 }));
		const results = await cameras.captureFieldCameras(fetchMock as unknown as typeof fetch);
		expect(results.every(r => !r.ok)).toBe(true);
		expect(results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/didn't send an image/) });
	});

	it("turns a thrown fetch into a failure rather than an exception", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		const results = await cameras.captureFieldCameras(fetchMock as unknown as typeof fetch);
		expect(results[0]).toMatchObject({ ok: false, error: "ECONNREFUSED" });
	});

	it("fails every camera, without calling out, when Home Assistant isn't configured", async () => {
		envState.HOME_ASSISTANT_TOKEN = undefined;
		const fetchMock = vi.fn();
		const results = await cameras.captureFieldCameras(fetchMock as unknown as typeof fetch);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(results).toHaveLength(2);
		expect(results.every(r => !r.ok)).toBe(true);
	});
});

describe("camera configuration", () => {
	it("lists the configured cameras in order", () => {
		expect(cameras.configuredCameras().map(c => c.label)).toEqual(["Field", "Rollup"]);
	});

	it("is only configured when all three settings are present", () => {
		envState.HOME_ASSISTANT_URL = "http://ha.test:8123/";
		envState.HOME_ASSISTANT_TOKEN = "a-long-lived-token-of-some-length";
		expect(cameras.camerasConfigured()).toBe(true);
		expect(cameras.cameraConfigProblem()).toBeNull();

		envState.HOME_ASSISTANT_URL = undefined;
		expect(cameras.camerasConfigured()).toBe(false);
		expect(cameras.cameraConfigProblem()).toMatch(/HOME_ASSISTANT_URL/);
	});
});
