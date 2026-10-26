import { describe, expect, it } from "vitest";
import {
	FIELD_ISSUE_KIND_IDS,
	FIELD_ISSUE_KINDS,
	fieldIssueKindInfo,
	isFieldIssueKind,
	isSnapshotFileName,
	parseFieldCameras,
	snapshotFileName,
	sniffImageType,
	sortSnapshots,
} from "~/server/util/fieldIssue";

describe("field issue kinds", () => {
	it("offers the five kinds the user asked for, in order", () => {
		expect(FIELD_ISSUE_KIND_IDS).toEqual(["safety", "repair_needed", "repair_made", "not_reset", "other"]);
	});

	it("only requires a note for 'other'", () => {
		expect(FIELD_ISSUE_KINDS.filter(k => k.notesRequired).map(k => k.kind)).toEqual(["other"]);
	});

	it("labels every kind", () => {
		for (const kind of FIELD_ISSUE_KIND_IDS) expect(fieldIssueKindInfo(kind).label).toBeTruthy();
	});

	it("rejects unknown kinds", () => {
		expect(isFieldIssueKind("safety")).toBe(true);
		expect(isFieldIssueKind("broken")).toBe(false);
		expect(isFieldIssueKind(42)).toBe(false);
		expect(() => fieldIssueKindInfo("broken" as never)).toThrow(/unknown/i);
	});
});

describe("sniffImageType", () => {
	it("recognises JPEG, PNG and WebP by signature", () => {
		expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
		expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
		const webp = new Uint8Array(16);
		webp.set([0x52, 0x49, 0x46, 0x46], 0);
		webp.set([0x57, 0x45, 0x42, 0x50], 8);
		expect(sniffImageType(webp)).toBe("image/webp");
	});

	it("refuses anything else, whatever it claims to be", () => {
		expect(sniffImageType(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull(); // "<svg"
		expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull(); // "GIF8"
		expect(sniffImageType(new Uint8Array([]))).toBeNull();
		// A RIFF container that isn't WebP (e.g. WAV)
		const wav = new Uint8Array(16);
		wav.set([0x52, 0x49, 0x46, 0x46], 0);
		wav.set([0x57, 0x41, 0x56, 0x45], 8);
		expect(sniffImageType(wav)).toBeNull();
	});
});

describe("snapshot file names", () => {
	const id = "6f1d1a2e-3b4c-4d5e-8f90-1a2b3c4d5e6f";

	it("are built from the id, the source and the type's extension", () => {
		expect(snapshotFileName(id, "camera", "image/jpeg")).toBe(`${id}-camera.jpg`);
		expect(snapshotFileName(id, "device", "image/png")).toBe(`${id}-device.png`);
		expect(snapshotFileName(id, "device", "image/webp")).toBe(`${id}-device.webp`);
	});

	it("round-trip through the URL check", () => {
		expect(isSnapshotFileName(snapshotFileName(id, "camera", "image/jpeg"))).toBe(true);
		expect(isSnapshotFileName(snapshotFileName(id, "device", "image/webp"))).toBe(true);
	});

	it("reject anything that could be a path or a different file", () => {
		expect(isSnapshotFileName("../users.json")).toBe(false);
		expect(isSnapshotFileName(`${id}-camera.jpg/..`)).toBe(false);
		expect(isSnapshotFileName(`${id}-camera.svg`)).toBe(false);
		expect(isSnapshotFileName(`${id}-other.jpg`)).toBe(false);
		expect(isSnapshotFileName("")).toBe(false);
	});
});

describe("parseFieldCameras", () => {
	it("is empty when unset or blank", () => {
		expect(parseFieldCameras(undefined)).toEqual([]);
		expect(parseFieldCameras("")).toEqual([]);
		expect(parseFieldCameras("  ")).toEqual([]);
	});

	it("parses labelled entity ids, keeping their order and trimming whitespace", () => {
		expect(parseFieldCameras("Field=camera.field_centered, South rollup = camera.south_rollup ,")).toEqual([
			{ label: "Field", source: { kind: "homeAssistant", entityId: "camera.field_centered" } },
			{ label: "South rollup", source: { kind: "homeAssistant", entityId: "camera.south_rollup" } },
		]);
	});

	it("takes a URL as a source, alongside entities", () => {
		expect(parseFieldCameras("Field=http://sentinel.tsl:9000/api/still/all-field, Door=camera.doorbell")).toEqual([
			{ label: "Field", source: { kind: "url", url: "http://sentinel.tsl:9000/api/still/all-field" } },
			{ label: "Door", source: { kind: "homeAssistant", entityId: "camera.doorbell" } },
		]);
		expect(parseFieldCameras("Field=HTTPS://cams.example/still?width=1600")[0]?.source).toEqual({
			kind: "url",
			url: "https://cams.example/still?width=1600",
		});
	});

	it("refuses malformed entries so a typo fails at startup", () => {
		expect(() => parseFieldCameras("camera.field_centered")).toThrow(/Label=camera/);
		expect(() => parseFieldCameras("=camera.field_centered")).toThrow(/Label=camera/);
		expect(() => parseFieldCameras("Field=light.kitchen")).toThrow(/neither a camera entity id nor an http/);
		expect(() => parseFieldCameras("Field=camera.Field")).toThrow(/neither/);
		expect(() => parseFieldCameras("Field=ftp://sentinel/still")).toThrow(/neither/);
		expect(() => parseFieldCameras("Field=http://")).toThrow(/neither/);
		expect(() => parseFieldCameras("Field=camera.a, Field=camera.b")).toThrow(/twice/);
	});
});

describe("sortSnapshots", () => {
	it("puts device photos first, each group oldest first", () => {
		const t = (ms: number) => new Date(ms);
		const sorted = sortSnapshots([
			{ source: "camera", taken: t(3) },
			{ source: "device", taken: t(2) },
			{ source: "camera", taken: t(1) },
			{ source: "device", taken: t(4) },
		]);
		expect(sorted.map(s => `${s.source}@${s.taken.getTime()}`)).toEqual([
			"device@2",
			"device@4",
			"camera@1",
			"camera@3",
		]);
	});
});
