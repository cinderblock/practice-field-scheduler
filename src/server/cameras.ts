import { env } from "~/env";
import { type FieldCamera, parseFieldCameras, type SnapshotImageType, sniffImageType } from "./util/fieldIssue";

/*
 * Stills from the shop's cameras, for field issue reports.
 *
 * The cameras are UniFi Protect units that Home Assistant already knows about, so rather
 * than talk to the NVR the scheduler asks Home Assistant for a frame:
 * `GET {HOME_ASSISTANT_URL}/api/camera_proxy/{entity_id}` with a long-lived access token.
 * Which cameras, and what to call them, is `FIELD_CAMERAS`. All three settings are
 * optional; without them there are simply no camera frames on reports.
 */

/** How long to wait for one camera before giving up on it. The report is filed regardless. */
export const CAMERA_CAPTURE_TIMEOUT_MS = 10_000;

export type CameraFrame = {
	camera: string;
	contentType: SnapshotImageType;
	bytes: Buffer;
	taken: Date;
};

export type CameraCaptureResult =
	| { camera: string; ok: true; frame: CameraFrame }
	| { camera: string; ok: false; error: string };

let parsed: FieldCamera[] | undefined;

/** The configured cameras, in the order they're listed. Empty when none are. */
export function configuredCameras(): FieldCamera[] {
	// env.js has already checked the format; this just caches the parse.
	parsed ??= parseFieldCameras(env.FIELD_CAMERAS);
	return parsed;
}

/** Whether frames can be captured at all: cameras listed, and Home Assistant reachable in principle. */
export function camerasConfigured(): boolean {
	return configuredCameras().length > 0 && !!env.HOME_ASSISTANT_URL && !!env.HOME_ASSISTANT_TOKEN;
}

/** Why `camerasConfigured()` is false, for the startup log. Null when it's true. */
export function cameraConfigProblem(): string | null {
	if (configuredCameras().length === 0) return null; // Not wanted; nothing to complain about
	if (!env.HOME_ASSISTANT_URL) return "FIELD_CAMERAS is set but HOME_ASSISTANT_URL is not";
	if (!env.HOME_ASSISTANT_TOKEN) return "FIELD_CAMERAS is set but HOME_ASSISTANT_TOKEN is not";
	return null;
}

async function captureOne(camera: FieldCamera, fetchImpl: typeof fetch): Promise<CameraCaptureResult> {
	const base = env.HOME_ASSISTANT_URL?.replace(/\/+$/, "");
	const token = env.HOME_ASSISTANT_TOKEN;
	if (!base || !token) return { camera: camera.label, ok: false, error: "Home Assistant is not configured" };

	const taken = new Date();
	try {
		const res = await fetchImpl(`${base}/api/camera_proxy/${encodeURIComponent(camera.entityId)}`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(CAMERA_CAPTURE_TIMEOUT_MS),
		});
		if (!res.ok) {
			return { camera: camera.label, ok: false, error: `Home Assistant answered ${res.status} ${res.statusText}` };
		}
		const bytes = Buffer.from(await res.arrayBuffer());
		const contentType = sniffImageType(bytes);
		if (!contentType) {
			return { camera: camera.label, ok: false, error: "Home Assistant didn't send an image" };
		}
		return { camera: camera.label, ok: true, frame: { camera: camera.label, contentType, bytes, taken } };
	} catch (err) {
		const message =
			err instanceof Error && err.name === "TimeoutError"
				? `No frame within ${CAMERA_CAPTURE_TIMEOUT_MS / 1000} seconds`
				: err instanceof Error
					? err.message
					: String(err);
		return { camera: camera.label, ok: false, error: message };
	}
}

/**
 * Grab a frame from every configured camera, all at once. Never throws: each camera reports
 * its own success or failure, so one being offline doesn't cost the others, or the report.
 */
export async function captureFieldCameras(fetchImpl: typeof fetch = fetch): Promise<CameraCaptureResult[]> {
	const cameras = configuredCameras();
	if (cameras.length === 0) return [];
	return Promise.all(cameras.map(camera => captureOne(camera, fetchImpl)));
}
