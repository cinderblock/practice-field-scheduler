import { env } from "~/env";
import { type FieldCamera, parseFieldCameras, type SnapshotImageType, sniffImageType } from "./util/fieldIssue";

/*
 * Stills from the shop's cameras, for field issue reports.
 *
 * Which cameras, and what to call them, is `FIELD_CAMERAS`. Each one is either a URL that
 * answers with an image (restitch's `/api/still/<stream>` serves the composite field view
 * that way) or a Home Assistant camera entity, fetched through HA's camera proxy
 * (`GET {HOME_ASSISTANT_URL}/api/camera_proxy/{entity_id}` with a long-lived access token).
 * Everything is optional; with nothing configured there are simply no camera frames on
 * reports.
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

/** Whether frames can be captured at all: cameras listed, and whatever they need configured. */
export function camerasConfigured(): boolean {
	return configuredCameras().length > 0 && cameraConfigProblem() === null;
}

/** Why `camerasConfigured()` is false, for the startup log. Null when it's true. */
export function cameraConfigProblem(): string | null {
	const needsHomeAssistant = configuredCameras().some(c => c.source.kind === "homeAssistant");
	if (!needsHomeAssistant) return null; // URL cameras need nothing else; no cameras need nothing at all
	if (!env.HOME_ASSISTANT_URL) return "FIELD_CAMERAS names a Home Assistant camera but HOME_ASSISTANT_URL is not set";
	if (!env.HOME_ASSISTANT_TOKEN)
		return "FIELD_CAMERAS names a Home Assistant camera but HOME_ASSISTANT_TOKEN is not set";
	return null;
}

/** The request for one camera's still, or why there can't be one. */
function requestFor(camera: FieldCamera): { url: string; headers: Record<string, string> } | { error: string } {
	if (camera.source.kind === "url") return { url: camera.source.url, headers: {} };

	const base = env.HOME_ASSISTANT_URL?.replace(/\/+$/, "");
	const token = env.HOME_ASSISTANT_TOKEN;
	if (!base || !token) return { error: "Home Assistant is not configured" };
	return {
		url: `${base}/api/camera_proxy/${encodeURIComponent(camera.source.entityId)}`,
		headers: { Authorization: `Bearer ${token}` },
	};
}

async function captureOne(camera: FieldCamera, fetchImpl: typeof fetch): Promise<CameraCaptureResult> {
	const request = requestFor(camera);
	if ("error" in request) return { camera: camera.label, ok: false, error: request.error };
	const who = camera.source.kind === "url" ? "The camera" : "Home Assistant";

	const taken = new Date();
	try {
		const res = await fetchImpl(request.url, {
			headers: request.headers,
			signal: AbortSignal.timeout(CAMERA_CAPTURE_TIMEOUT_MS),
		});
		if (!res.ok) {
			return { camera: camera.label, ok: false, error: `${who} answered ${res.status} ${res.statusText}` };
		}
		const bytes = Buffer.from(await res.arrayBuffer());
		const contentType = sniffImageType(bytes);
		if (!contentType) {
			return { camera: camera.label, ok: false, error: `${who} didn't send an image` };
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
