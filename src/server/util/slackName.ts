import type { Team } from "~/types";

/**
 * Slack name rules. A person's two Slack names do different jobs:
 *
 *   Full name      "Jane Doe"                 just a name
 *   Display name   "Jane Doe (1234)"          a name, then affiliation(s) in parens
 *                  "Jane Doe (1234, 5678)"    several teams, comma-separated
 *                  "Jane Doe (TSL)"           approved non-team marker (lab mates)
 *
 * "Just a name" means no parentheses or brackets and no digits, so team
 * numbers can only ever come from the display name's trailing parens. The two
 * names don't have to match; nicknames are fine.
 */
const NAME_WITH_SUFFIX = /^\s*(?<displayName>\S.*\S|\S)\s*\(\s*(?<suffix>[^)]+?)\s*\)\s*$/;
const TEAMS_SUFFIX = /^\d+(?:\s*,\s*\d+)*$/;
const NOT_JUST_A_NAME = /[()[\]{}<>\d]/;

/**
 * Approved non-team parens markers. Names ending in `(TSL)` belong to lab
 * mates who aren't on an FRC team. They validate successfully (so their gate
 * links aren't held over their names) but parse to `teams: []`, so they don't
 * get auto gate access from team reservations.
 *
 * Matched case-sensitively — the convention is the exact uppercase string.
 */
export const APPROVED_NON_TEAM_ROLES = ["TSL"] as const;
export type ApprovedRole = (typeof APPROVED_NON_TEAM_ROLES)[number];

export type ParsedSlackName = {
	/** The human-readable name portion (text before the opening paren). */
	displayName: string;
	/** Team numbers extracted from inside the parens, in source order. Empty for role-only names like "(TSL)". */
	teams: Team[];
	/**
	 * Non-null when the parens contained an approved non-team marker
	 * (e.g. `"TSL"`). Always `null` when teams are present — the two
	 * forms are mutually exclusive in this branch's grammar.
	 */
	role: ApprovedRole | null;
};

function asApprovedRole(suffix: string): ApprovedRole | null {
	return (APPROVED_NON_TEAM_ROLES as readonly string[]).includes(suffix) ? (suffix as ApprovedRole) : null;
}

/**
 * Split a display name into its name and its "(…)" affiliation. Returns null
 * if the trailing parens aren't a team-number list or an approved role. Says
 * nothing about whether the name part is "just a name"; see
 * {@link checkSlackNames} for the full rules.
 */
export function parseSlackName(name: string | null | undefined): ParsedSlackName | null {
	if (!name) return null;
	const match = NAME_WITH_SUFFIX.exec(name);
	if (!match?.groups) return null;
	const { displayName, suffix } = match.groups as { displayName: string; suffix: string };

	const role = asApprovedRole(suffix);
	if (role) return { displayName: displayName.trim(), teams: [], role };

	if (!TEAMS_SUFFIX.test(suffix)) return null;
	const teams = suffix
		.split(",")
		.map(s => Number.parseInt(s.trim(), 10))
		.filter(n => Number.isFinite(n) && n > 0);
	if (teams.length === 0) return null;
	return { displayName: displayName.trim(), teams, role: null };
}

/** Not empty, and no parentheses, brackets or digits. */
export function isJustAName(value: string | null | undefined): boolean {
	const v = value?.trim();
	return Boolean(v) && !NOT_JUST_A_NAME.test(v as string);
}

/** What's wrong with someone's Slack names. */
export type SlackNameIssue =
	/** We haven't been able to read their names from Slack. */
	| "unverified"
	| "full_name_missing"
	| "full_name_not_just_a_name"
	| "display_name_missing"
	| "display_name_no_affiliation"
	| "display_name_not_just_a_name";

export type SlackNames = { realName?: string | null; displayName?: string | null };

/** Corrected names, when we can work out what they should be. */
export type SuggestedNames = { realName: string | null; displayName: string | null };

export type SlackNameCheck = {
	ok: boolean;
	issues: SlackNameIssue[];
	/**
	 * The display name's affiliation, when the display name itself follows the
	 * rules, even if the full name doesn't. Teams are taken from here.
	 */
	affiliation: ParsedSlackName | null;
	/** Suggested fixes; null when the names are fine or we can't tell. */
	suggestion: SuggestedNames | null;
};

export const UNVERIFIED_NAMES: SlackNameCheck = {
	ok: false,
	issues: ["unverified"],
	affiliation: null,
	suggestion: null,
};

/** Check a person's full name and display name against the rules. */
export function checkSlackNames({ realName, displayName }: SlackNames): SlackNameCheck {
	const real = realName?.trim() ?? "";
	const display = displayName?.trim() ?? "";
	const issues: SlackNameIssue[] = [];

	if (!real) issues.push("full_name_missing");
	else if (!isJustAName(real)) issues.push("full_name_not_just_a_name");

	const parsed = parseSlackName(display);
	if (!display) issues.push("display_name_missing");
	else if (!parsed) issues.push("display_name_no_affiliation");
	else if (!isJustAName(parsed.displayName)) issues.push("display_name_not_just_a_name");

	const displayOk = parsed !== null && isJustAName(parsed.displayName);
	return {
		ok: issues.length === 0,
		issues,
		affiliation: displayOk ? parsed : null,
		suggestion: issues.length === 0 ? null : suggestNames(real, display, parsed),
	};
}

export function formatAffiliation(parsed: Pick<ParsedSlackName, "teams" | "role">): string {
	return parsed.role ?? parsed.teams.join(", ");
}

/** Strip anything that isn't part of a name: bracketed text, digits, dangling separators. */
function stripToName(value: string): string {
	return value
		.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|<[^>]*>/g, " ")
		.replace(/[()[\]{}<>\d]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[\s,;:|/\-–—#]+|[\s,;:|/\-–—#]+$/g, "")
		.trim();
}

/** Find a team list or approved role somewhere in a name, for suggestions. */
function findAffiliation(...values: string[]): string | null {
	for (const value of values) {
		for (const [, group] of value.matchAll(/\(([^)]*)\)/g)) {
			const parsed = parseSlackName(`x (${group})`);
			if (parsed) return formatAffiliation(parsed);
		}
	}
	const numbers = values.flatMap(v => [...v.matchAll(/\b\d{1,5}\b/g)].map(m => Number.parseInt(m[0], 10)));
	const teams = [...new Set(numbers.filter(n => n > 0))];
	return teams.length > 0 ? teams.join(", ") : null;
}

/**
 * Suggest values only for the names that are wrong. A display name keeps the
 * name the person chose for it (a nickname is fine), cleaned up.
 */
function suggestNames(real: string, display: string, parsed: ParsedSlackName | null): SuggestedNames | null {
	const displayBase = stripToName(parsed?.displayName ?? display);
	const realBase = stripToName(real) || displayBase;
	const affiliation = parsed ? formatAffiliation(parsed) : findAffiliation(real, display);
	const displayOk = parsed !== null && isJustAName(parsed.displayName);

	const base = displayBase || realBase;
	const suggestion: SuggestedNames = {
		realName: isJustAName(real) ? null : realBase || null,
		displayName: displayOk || !base || !affiliation ? null : `${base} (${affiliation})`,
	};
	return suggestion.realName || suggestion.displayName ? suggestion : null;
}

/** One-line, human description of an issue, for admins and DMs. */
export function describeSlackNameIssue(issue: SlackNameIssue): string {
	switch (issue) {
		case "unverified":
			return "Names haven't been checked with Slack yet";
		case "full_name_missing":
			return "Full name is empty";
		case "full_name_not_just_a_name":
			return "Full name has more than a name in it (team numbers or parentheses)";
		case "display_name_missing":
			return "Display name is empty";
		case "display_name_no_affiliation":
			return "Display name doesn't end with team number(s) in parentheses";
		case "display_name_not_just_a_name":
			return "Display name has extra numbers or parentheses in the name part";
	}
}
