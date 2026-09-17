import { describe, expect, it } from "vitest";
import {
	checkSlackNames,
	describeSlackNameIssue,
	isJustAName,
	parseSlackName,
	type SlackNameIssue,
} from "~/server/util/slackName";

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

describe("isJustAName", () => {
	it("accepts ordinary names, including hyphens, apostrophes and accents", () => {
		expect(isJustAName("Jane Doe")).toBe(true);
		expect(isJustAName("Jean-Luc O'Brien")).toBe(true);
		expect(isJustAName("Zoë Ñúñez")).toBe(true);
	});

	it("rejects empty names, digits and brackets of any kind", () => {
		expect(isJustAName("")).toBe(false);
		expect(isJustAName("   ")).toBe(false);
		expect(isJustAName(undefined)).toBe(false);
		expect(isJustAName("Jane Doe 1234")).toBe(false);
		expect(isJustAName("Jane Doe (1234)")).toBe(false);
		expect(isJustAName("Jane [TSL]")).toBe(false);
		expect(isJustAName("Jane {x}")).toBe(false);
	});
});

describe("checkSlackNames", () => {
	const issuesOf = (realName: string | undefined, displayName: string | undefined): SlackNameIssue[] =>
		checkSlackNames({ realName, displayName }).issues;

	it("passes a plain full name with a team-tagged display name", () => {
		const check = checkSlackNames({ realName: "Jane Doe", displayName: "Jane Doe (1234, 5678)" });
		expect(check).toEqual({
			ok: true,
			issues: [],
			affiliation: { displayName: "Jane Doe", teams: [1234, 5678], role: null },
			suggestion: null,
		});
	});

	it("passes lab mates and nicknames", () => {
		expect(checkSlackNames({ realName: "Lab Mate", displayName: "Labby (TSL)" }).ok).toBe(true);
		expect(checkSlackNames({ realName: "Robert Roe", displayName: "Bob (1234)" }).ok).toBe(true);
	});

	it("rejects team numbers in the full name", () => {
		expect(issuesOf("Jane Doe (1234)", "Jane Doe (1234)")).toEqual(["full_name_not_just_a_name"]);
		expect(issuesOf("Jane Doe 1234", "Jane Doe (1234)")).toEqual(["full_name_not_just_a_name"]);
	});

	it("rejects a display name without an affiliation, or with a missing name", () => {
		expect(issuesOf("Jane Doe", "Jane Doe")).toEqual(["display_name_no_affiliation"]);
		expect(issuesOf("Jane Doe", "Jane Doe (mentor)")).toEqual(["display_name_no_affiliation"]);
		expect(issuesOf("Jane Doe", "")).toEqual(["display_name_missing"]);
		expect(issuesOf("Jane Doe", undefined)).toEqual(["display_name_missing"]);
		expect(issuesOf("", "Jane Doe (1234)")).toEqual(["full_name_missing"]);
	});

	it("rejects extra numbers or parentheses in the display name's name part", () => {
		expect(issuesOf("Jane Doe", "Jane (x) (1234)")).toEqual(["display_name_not_just_a_name"]);
		expect(issuesOf("Jane Doe", "Jane Doe 42 (1234)")).toEqual(["display_name_not_just_a_name"]);
	});

	it("still reports teams from a good display name when the full name is wrong", () => {
		const check = checkSlackNames({ realName: "Jane Doe (1234)", displayName: "Jane Doe (1234)" });
		expect(check.ok).toBe(false);
		expect(check.affiliation?.teams).toEqual([1234]);
	});

	it("reports no teams from a display name that breaks the rules", () => {
		expect(checkSlackNames({ realName: "Jane Doe", displayName: "Jane (x) (1234)" }).affiliation).toBeNull();
	});

	describe("suggestions", () => {
		const suggest = (realName: string, displayName: string) => checkSlackNames({ realName, displayName }).suggestion;

		it("moves teams out of the full name and into the display name", () => {
			expect(suggest("Jane Doe (1234, 5678)", "")).toEqual({
				realName: "Jane Doe",
				displayName: "Jane Doe (1234, 5678)",
			});
		});

		it("finds bare team numbers and keeps the chosen display name", () => {
			expect(suggest("Jane Doe - 1234", "Janey")).toEqual({ realName: "Jane Doe", displayName: "Janey (1234)" });
		});

		it("cleans up the display name's own name part", () => {
			expect(suggest("Jane Doe", "Janey 42 (1234)")).toEqual({ realName: null, displayName: "Janey (1234)" });
		});

		it("only suggests the names that are wrong", () => {
			expect(suggest("Robert Roe (1234)", "Bob (1234)")).toEqual({ realName: "Robert Roe", displayName: null });
		});

		it("keeps the TSL marker", () => {
			expect(suggest("Lab Mate (TSL)", "")).toEqual({ realName: "Lab Mate", displayName: "Lab Mate (TSL)" });
		});

		it("can't suggest a display name without knowing the team", () => {
			expect(suggest("Jane Doe", "Jane")).toBeNull();
			expect(suggest("Jane Doe (x)", "Jane")).toEqual({ realName: "Jane Doe", displayName: null });
		});

		it("suggests nothing when there's no name to work from", () => {
			expect(suggest("", "")).toBeNull();
		});

		it("suggests nothing when the names are fine", () => {
			expect(suggest("Jane Doe", "Jane (1234)")).toBeNull();
		});
	});
});

describe("describeSlackNameIssue", () => {
	it("has words for every issue", () => {
		const issues: SlackNameIssue[] = [
			"unverified",
			"full_name_missing",
			"full_name_not_just_a_name",
			"display_name_missing",
			"display_name_no_affiliation",
			"display_name_not_just_a_name",
		];
		for (const issue of issues) expect(describeSlackNameIssue(issue)).toMatch(/\w/);
	});
});
