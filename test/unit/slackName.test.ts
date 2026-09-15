import { describe, expect, it } from "vitest";
import { isValidSlackName, parseSlackName, pickNameForValidation } from "~/server/util/slackName";

describe("parseSlackName", () => {
	it("parses single-team format", () => {
		expect(parseSlackName("Jane Doe (1234)")).toEqual({ displayName: "Jane Doe", teams: [1234], role: null });
	});

	it("parses multi-team format with comma separation", () => {
		expect(parseSlackName("Jane Doe (1234, 5678)")).toEqual({
			displayName: "Jane Doe",
			teams: [1234, 5678],
			role: null,
		});
	});

	it("tolerates extra whitespace inside and outside the parens", () => {
		expect(parseSlackName("  Jane Doe   ( 1234 ,  5678 )  ")).toEqual({
			displayName: "Jane Doe",
			teams: [1234, 5678],
			role: null,
		});
	});

	it("accepts hyphenated and single-word names", () => {
		expect(parseSlackName("Jean-Luc (42)")).toEqual({ displayName: "Jean-Luc", teams: [42], role: null });
		expect(parseSlackName("Q (42)")).toEqual({ displayName: "Q", teams: [42], role: null });
	});

	it("rejects missing team parens", () => {
		expect(parseSlackName("Jane Doe")).toBeNull();
	});

	it("rejects parens without a number", () => {
		expect(parseSlackName("Jane Doe ()")).toBeNull();
		expect(parseSlackName("Jane Doe (abc)")).toBeNull();
	});

	it("rejects empty name portion", () => {
		expect(parseSlackName("(1234)")).toBeNull();
	});

	it("rejects extra text after the parens", () => {
		expect(parseSlackName("Jane Doe (1234) extra")).toBeNull();
	});

	it("rejects empty/null/undefined input", () => {
		expect(parseSlackName("")).toBeNull();
		expect(parseSlackName(null)).toBeNull();
		expect(parseSlackName(undefined)).toBeNull();
	});

	it("rejects team number 0", () => {
		expect(parseSlackName("Jane Doe (0)")).toBeNull();
	});

	it("accepts the approved (TSL) non-team marker for lab mates", () => {
		expect(parseSlackName("Jane Doe (TSL)")).toEqual({ displayName: "Jane Doe", teams: [], role: "TSL" });
	});

	it("tolerates whitespace around the (TSL) marker", () => {
		expect(parseSlackName("Jane Doe ( TSL )")).toEqual({ displayName: "Jane Doe", teams: [], role: "TSL" });
	});

	it("rejects lowercase or mixed-case TSL (convention is the exact uppercase string)", () => {
		expect(parseSlackName("Jane Doe (tsl)")).toBeNull();
		expect(parseSlackName("Jane Doe (Tsl)")).toBeNull();
	});

	it("rejects unrecognized non-numeric roles", () => {
		expect(parseSlackName("Jane Doe (mentor)")).toBeNull();
		expect(parseSlackName("Jane Doe (guest)")).toBeNull();
	});

	it("rejects mixing TSL with team numbers", () => {
		expect(parseSlackName("Jane Doe (TSL, 1234)")).toBeNull();
		expect(parseSlackName("Jane Doe (1234, TSL)")).toBeNull();
	});
});

describe("isValidSlackName", () => {
	it("agrees with parseSlackName", () => {
		expect(isValidSlackName("Jane Doe (1234)")).toBe(true);
		expect(isValidSlackName("Jane Doe")).toBe(false);
	});
});

describe("pickNameForValidation", () => {
	it("prefers displayName when set", () => {
		expect(pickNameForValidation({ name: "Real Name", displayName: "Display (1234)" })).toBe("Display (1234)");
	});

	it("falls back to name when displayName is empty", () => {
		expect(pickNameForValidation({ name: "Real Name (1234)", displayName: "" })).toBe("Real Name (1234)");
		expect(pickNameForValidation({ name: "Real Name (1234)", displayName: undefined })).toBe("Real Name (1234)");
	});

	it("returns empty string when neither is set", () => {
		expect(pickNameForValidation({})).toBe("");
	});
});
