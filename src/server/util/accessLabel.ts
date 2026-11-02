import type { TeamFull, UserEntry } from "~/types";

/**
 * Readable labels for gate links, so `/g/team-1234-Kx9v…` says what it is.
 *
 * A label is decoration: lookup matches the whole token, and the random part
 * after it carries all the entropy. Nothing may ever parse or trust a label.
 * It records who the link was for when it was issued, so a later name change
 * leaves old links as they were.
 */

const MAX_LABEL_LENGTH = 48;

/** Lowercase ASCII words joined by hyphens: "José O'Brien" → "jose-obrien". */
function slug(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/['’]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function capped(label: string): string {
	return label.slice(0, MAX_LABEL_LENGTH).replace(/-+$/, "");
}

/** `team-1234` for a team's shared link. */
export function teamLinkLabel(team: TeamFull): string {
	const name = slug(String(team));
	return capped(name ? `team-${name}` : "team");
}

/**
 * First name, last initial and team numbers: `jane-d-1234-5678`. Only an
 * initial, because links get pasted into chat and sit in browser history.
 * Names that leave nothing in ASCII fall back to `member`.
 */
export function personalLinkLabel(user: Pick<UserEntry, "name" | "teams">): string {
	const words = user.name.trim().split(/\s+/).map(slug).filter(Boolean);
	const first = words[0];
	const initial = words.length > 1 ? words[words.length - 1]?.[0] : undefined;
	const teams = user.teams === "admin" ? [] : user.teams.map(team => slug(String(team))).filter(Boolean);
	const parts = [first, initial, ...teams].filter(Boolean);
	return capped(parts.join("-")) || "member";
}
