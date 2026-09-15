import type { Team } from "~/types";

/**
 * Slack-display-name format the scheduler expects:
 *   "First Last (1234)"           // single team
 *   "First Last (1234, 5678)"    // multiple teams, comma-separated
 *   "First Last (TSL)"            // approved non-team marker (lab mates)
 *
 * The text before the parens is treated opaquely (any non-empty content);
 * what matters is that the contents of the trailing parens either parse
 * as one-or-more team numbers OR exactly match one of the approved
 * non-team role markers below.
 */
const NAME_WITH_SUFFIX = /^\s*(?<displayName>\S.*\S|\S)\s*\(\s*(?<suffix>[^)]+?)\s*\)\s*$/;
const TEAMS_SUFFIX = /^\d+(?:\s*,\s*\d+)*$/;

/**
 * Approved non-team parens markers. Names ending in `(TSL)` belong to lab
 * mates who aren't on an FRC team. They validate successfully (so they're
 * allowed to log in under STRICT_SLACK_NAMES) but parse to `teams: []`,
 * so they don't get auto gate access from team reservations.
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
 * Parse a Slack display name in the expected format. Returns null if the
 * string doesn't match either grammar (team-number list or approved role).
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

export function isValidSlackName(name: string | null | undefined): boolean {
	return parseSlackName(name) !== null;
}

/**
 * Returns whichever of (displayName, name) the user should be validated
 * against. Prefer displayName (what's shown in Slack messages); fall back
 * to real_name when display name isn't set.
 */
export function pickNameForValidation(user: { name?: string | null; displayName?: string | null }): string {
	const candidate = (user.displayName ?? "").trim() || (user.name ?? "").trim();
	return candidate;
}
