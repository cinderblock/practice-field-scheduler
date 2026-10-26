import type { FieldIssueKind, FieldIssueSnapshot } from "~/types";

/*
 * Pure helpers for field issue reports. Shared by the server, the calendar dialog and the
 * admin viewer, so nothing here reads `~/env` or touches the filesystem.
 */

export type FieldIssueKindInfo = {
	kind: FieldIssueKind;
	/** Short label for a button or chip. */
	label: string;
	/** One line under the label in the dialog. */
	description: string;
	/** Whether a report of this kind has to say something in its notes. */
	notesRequired: boolean;
};

/** The kinds of report, in the order the dialog offers them. */
export const FIELD_ISSUE_KINDS: readonly FieldIssueKindInfo[] = [
	{
		kind: "safety",
		label: "Safety issue",
		description: "Something could hurt someone. Say what and where.",
		notesRequired: false,
	},
	{
		kind: "repair_needed",
		label: "Repair needed",
		description: "Something is broken, loose or missing.",
		notesRequired: false,
	},
	{
		kind: "repair_made",
		label: "Repair made",
		description: "You fixed something. Say what, so the next team knows.",
		notesRequired: false,
	},
	{
		kind: "not_reset",
		label: "Field not reset",
		description: "The field wasn't put back the way it should be.",
		notesRequired: false,
	},
	{
		kind: "other",
		label: "Other",
		description: "Anything else worth a note and a picture.",
		notesRequired: true,
	},
];

export const FIELD_ISSUE_KIND_IDS = FIELD_ISSUE_KINDS.map(k => k.kind) as [FieldIssueKind, ...FieldIssueKind[]];

export function fieldIssueKindInfo(kind: FieldIssueKind): FieldIssueKindInfo {
	const info = FIELD_ISSUE_KINDS.find(k => k.kind === kind);
	if (!info) throw new Error(`Unknown field issue kind: ${kind}`);
	return info;
}

export function isFieldIssueKind(value: unknown): value is FieldIssueKind {
	return typeof value === "string" && FIELD_ISSUE_KIND_IDS.includes(value as FieldIssueKind);
}

/** Longest a report's notes (and an admin's resolution note) may be. */
export const FIELD_ISSUE_NOTES_MAX = 2000;

/** Device photos per report. Camera frames don't count against this. */
export const MAX_PHOTOS_PER_ISSUE = 10;

/**
 * Per photo, after the browser has downscaled it. A 1600 px JPEG is a few hundred KB; this
 * leaves room for a browser that couldn't resize and sent the original.
 */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Longest side of a photo once the browser has downscaled it, in pixels. */
export const PHOTO_MAX_SIDE = 1600;

/**
 * How long after filing a report its author may still add photos to it. Uploads follow the
 * report within seconds; the window just lets a failed upload be retried without turning
 * every old report into something anyone can append pictures to.
 */
export const PHOTO_UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/** The image types a snapshot may be. Anything else is refused, whatever the browser claimed. */
export type SnapshotImageType = "image/jpeg" | "image/png" | "image/webp";

const EXTENSION: Record<SnapshotImageType, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};

/**
 * Work out what kind of image some bytes are from their signature, ignoring whatever
 * content type came with them. Null when they're not an image we store.
 */
export function sniffImageType(bytes: Uint8Array): SnapshotImageType | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	)
		return "image/png";
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 && // R
		bytes[1] === 0x49 && // I
		bytes[2] === 0x46 && // F
		bytes[3] === 0x46 && // F
		bytes[8] === 0x57 && // W
		bytes[9] === 0x45 && // E
		bytes[10] === 0x42 && // B
		bytes[11] === 0x50 // P
	)
		return "image/webp";
	return null;
}

/**
 * The filename a snapshot is stored under inside its report's directory. Built only from a
 * generated id, the source and a known extension, so it can never be a path.
 */
export function snapshotFileName(id: string, source: FieldIssueSnapshot["source"], type: SnapshotImageType): string {
	return `${id}-${source}.${EXTENSION[type]}`;
}

/**
 * Whether a filename from a URL could be one we wrote. The record is still the authority on
 * which files belong to a report; this just rejects anything that isn't shaped like ours
 * before it gets near the filesystem.
 */
export function isSnapshotFileName(name: string): boolean {
	return /^[0-9a-f-]{36}-(device|camera)\.(jpg|png|webp)$/.test(name);
}

/**
 * Where a camera's still comes from.
 *
 * - `url`: any address that answers a GET with a JPEG, PNG or WebP, fetched as-is. This is
 *   how restitch's composite field view is reached (`http://sentinel:9000/api/still/all-field`).
 * - `homeAssistant`: a camera entity, fetched through Home Assistant's camera proxy with the
 *   deployment's `HOME_ASSISTANT_URL` and `HOME_ASSISTANT_TOKEN`.
 */
export type FieldCameraSource = { kind: "url"; url: string } | { kind: "homeAssistant"; entityId: string };

/** One of the shop's cameras, as configured in `FIELD_CAMERAS`. */
export type FieldCamera = {
	/** How the camera is named to people, e.g. "Field". */
	label: string;
	source: FieldCameraSource;
};

const ENTITY_ID = /^camera\.[a-z0-9_]+$/;

function parseCameraSource(value: string): FieldCameraSource | null {
	if (ENTITY_ID.test(value)) return { kind: "homeAssistant", entityId: value };
	if (/^https?:\/\//i.test(value)) {
		try {
			return { kind: "url", url: new URL(value).toString() };
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Parse `FIELD_CAMERAS`: comma-separated `Label=<source>` pairs, where a source is either a
 * Home Assistant camera entity id (`camera.field_centered`) or an `http(s)://` URL that
 * answers with an image. Labels may contain spaces. Throws on anything malformed so a typo
 * fails at startup rather than silently dropping a camera.
 */
export function parseFieldCameras(value: string | undefined): FieldCamera[] {
	if (!value || !value.trim()) return [];

	const cameras: FieldCamera[] = [];
	for (const raw of value.split(",")) {
		const part = raw.trim();
		if (!part) continue;
		const eq = part.indexOf("=");
		if (eq <= 0) {
			throw new Error(`FIELD_CAMERAS entry "${part}" must look like Label=camera.entity_id or Label=http://…`);
		}
		const label = part.slice(0, eq).trim();
		const value = part.slice(eq + 1).trim();
		if (!label) throw new Error(`FIELD_CAMERAS entry "${part}" has no label`);
		const source = parseCameraSource(value);
		if (!source) {
			throw new Error(`FIELD_CAMERAS entry "${part}": "${value}" is neither a camera entity id nor an http(s) URL`);
		}
		if (cameras.some(c => c.label === label)) throw new Error(`FIELD_CAMERAS lists "${label}" twice`);
		cameras.push({ label, source });
	}
	return cameras;
}

/** Device photos first in the order they were added, then camera frames in configured order. */
export function sortSnapshots<T extends Pick<FieldIssueSnapshot, "source" | "taken">>(snapshots: readonly T[]): T[] {
	return [...snapshots].sort((a, b) => {
		if (a.source !== b.source) return a.source === "device" ? -1 : 1;
		return a.taken.getTime() - b.taken.getTime();
	});
}
