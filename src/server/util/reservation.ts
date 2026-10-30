import type { TeamFull } from "~/types";

/** The largest team number we accept. The avatar route holds to the same limit. */
export const MAX_TEAM_NUMBER = 100_000;

/** A reservation's note is a few words on a calendar pill. */
export const RESERVATION_NOTES_MAX = 100;

/** A positive whole number written plainly: digits only, no leading zero. */
export function isValidTeamNumber(team: TeamFull): boolean {
	const text = String(team);
	return /^[1-9]\d*$/.test(text) && Number(text) <= MAX_TEAM_NUMBER;
}
