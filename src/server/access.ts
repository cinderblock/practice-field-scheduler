import type { Reservation, TeamFull, UserEntry } from "~/types";
import { checkSlackNames, type SlackNameCheck, UNVERIFIED_NAMES } from "./util/slackName";
import { atFieldTime, fieldDateOf, getReservationWindow, parseEventDate } from "./util/slotTime";

/** Tools the scheduler is willing to be asked about. */
export const SUPPORTED_TOOLS = ["gate"] as const;
export type Tool = (typeof SUPPORTED_TOOLS)[number];

/**
 * Grace period applied before the reservation's slot start. Lets teams arrive
 * a little early without being denied.
 */
export const ACCESS_PRE_START_GRACE_MS = 20 * 60 * 1000;

/**
 * Grace period applied after the reservation's slot end. Lets teams finish
 * driving, pack up and lock the trailer without getting shut out.
 */
export const ACCESS_POST_END_GRACE_MS = 60 * 60 * 1000;

/**
 * Site hours, as whole hours in the field's timezone. Nothing the scheduler
 * issues works outside them: personal links work throughout, team links are
 * clamped to them. Overnight, only Gate Manager's own registered employees can
 * open the gate — that path never asks the scheduler.
 */
export const SITE_OPEN_HOUR = 8;
export const SITE_CLOSE_HOUR = 23;

/** What kind of link granted (or was refused) access. */
export type AccessGrant = "team" | "personal";

export type AccessTeam = {
	id: string;
	name: string;
};

export type AccessUser = {
	id: string;
	name: string;
};

type Window = { start: Date; end: Date };

export type AccessCheckSuccess =
	| {
			valid: true;
			grant: "team";
			tool: string;
			/** Always null: a team link is shared, so nobody knows who clicked. */
			user: null;
			team: AccessTeam;
			reservation_id: string;
			window_starts_at: string;
			window_ends_at: string;
	  }
	| {
			valid: true;
			grant: "personal";
			tool: string;
			user: AccessUser;
			/** Always null: a personal link isn't tied to a team or reservation. */
			team: null;
			reservation_id: null;
			/** Today's site hours. */
			window_starts_at: string;
			window_ends_at: string;
	  };

export type AccessCheckDenialReason = "outside_window" | "unknown_token" | "revoked" | "tool_not_authorized";

export type AccessCheckDenial = {
	valid: false;
	reason: AccessCheckDenialReason;
	/** Null only when the token matched nothing. */
	grant: AccessGrant | null;
	tool: string;
	user: AccessUser | null;
	team: AccessTeam | null;
	window_starts_at: string | null;
	window_ends_at: string | null;
};

export type AccessCheckResult = AccessCheckSuccess | AccessCheckDenial;

/**
 * Whatever the presented token resolved to. For a personal link, pass the
 * live user record so disabling, revoking or broken Slack names take effect on
 * the very next check.
 */
export type AccessPrincipal = { kind: "team"; team: TeamFull } | { kind: "personal"; user: UserEntry };

function teamFor(team: TeamFull): AccessTeam {
	const id = team.toString();
	return { id, name: `Team ${id}` };
}

function userFor(user: UserEntry): AccessUser {
	return { id: user.id, name: user.displayName ?? user.name };
}

function isSupportedTool(tool: string): tool is Tool {
	return (SUPPORTED_TOOLS as readonly string[]).includes(tool);
}

function deny(
	reason: AccessCheckDenialReason,
	grant: AccessGrant | null,
	tool: string,
	{
		user = null,
		team = null,
		window = null,
	}: { user?: AccessUser | null; team?: AccessTeam | null; window?: Window | null } = {},
): AccessCheckDenial {
	return {
		valid: false,
		reason,
		grant,
		tool,
		user,
		team,
		window_starts_at: window?.start.toISOString() ?? null,
		window_ends_at: window?.end.toISOString() ?? null,
	};
}

/** A whole hour on a 12-hour clock, e.g. 23 → "11pm", 0 → "12am". */
export function formatHour(hour: number): string {
	const suffix = hour % 24 < 12 ? "am" : "pm";
	const twelve = hour % 12 === 0 ? 12 : hour % 12;
	return `${twelve}${suffix}`;
}

/** Human-readable site hours, e.g. "8am–11pm", for messages. */
export function describeSiteHours(): string {
	return `${formatHour(SITE_OPEN_HOUR)}–${formatHour(SITE_CLOSE_HOUR)}`;
}

function siteHoursOnDate(year: number, month: number, day: number): Window {
	return {
		start: atFieldTime(year, month, day, SITE_OPEN_HOUR),
		end: atFieldTime(year, month, day, SITE_CLOSE_HOUR),
	};
}

/**
 * The site-hours window that is open at `now`, or else the next one to open.
 */
export function currentOrNextSiteHours(now: Date): Window {
	const { year, month, day } = fieldDateOf(now);
	const today = siteHoursOnDate(year, month, day);
	if (now < today.end) return today;
	return siteHoursOnDate(year, month, day + 1);
}

/**
 * Compute the absolute access window for a reservation: slot bounds padded by
 * the grace periods, then clamped to site hours on the reservation's date.
 * Returns null for malformed input or if nothing is left after clamping.
 */
export function computeAccessWindow(reservation: Reservation): Window | null {
	const slot = getReservationWindow(reservation.date, reservation.slot);
	const date = parseEventDate(reservation.date);
	if (!slot || !date) return null;

	const hours = siteHoursOnDate(date.year, date.month, date.day);
	const start = Math.max(slot.start.getTime() - ACCESS_PRE_START_GRACE_MS, hours.start.getTime());
	const end = Math.min(slot.end.getTime() + ACCESS_POST_END_GRACE_MS, hours.end.getTime());
	if (start >= end) return null;
	return { start: new Date(start), end: new Date(end) };
}

/**
 * Whether a user should hold a working personal link: an admin has approved
 * them for general gate access, the account isn't disabled, and their Slack
 * names follow the rules. Team membership isn't required — admins and `(TSL)`
 * lab mates can be approved too.
 */
export function isPersonalAccessEligible(user: UserEntry): boolean {
	if (user.disabled) return false;
	if (!user.generalAccessApproved) return false;
	return hasValidSlackNames(user);
}

/**
 * Check a user's stored Slack names. Names that were never read from Slack's
 * Web API count as wrong: sign-in alone can't see the display name.
 */
export function slackNameCheckFor(
	user: Pick<UserEntry, "name" | "displayName" | "slackNamesSyncedAt">,
): SlackNameCheck {
	if (!user.slackNamesSyncedAt) return UNVERIFIED_NAMES;
	return checkSlackNames({ realName: user.name, displayName: user.displayName });
}

/** Whether a user's Slack names are verified and follow the rules; gate links wait on this. */
export function hasValidSlackNames(user: Pick<UserEntry, "name" | "displayName" | "slackNamesSyncedAt">): boolean {
	return slackNameCheckFor(user).ok;
}

/**
 * Tolerant team comparison: numeric strings from the tRPC input layer match
 * stored numbers, while house/special teams compare as trimmed strings.
 */
export function sameTeam(a: TeamFull, b: TeamFull): boolean {
	const na = typeof a === "string" ? Number.parseInt(a, 10) : a;
	const nb = typeof b === "string" ? Number.parseInt(b, 10) : b;
	if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
	return String(a).trim() === String(b).trim();
}

type WindowedReservation = { reservation: Reservation; window: Window };

function windowsFor(team: TeamFull, reservations: readonly Reservation[]): WindowedReservation[] {
	const out: WindowedReservation[] = [];
	for (const reservation of reservations) {
		if (reservation.abandoned) continue;
		if (!sameTeam(reservation.team, team)) continue;
		const window = computeAccessWindow(reservation);
		if (window) out.push({ reservation, window });
	}
	return out;
}

/**
 * The window whose edge is nearest `now` (most-recent past or next upcoming).
 * Used to populate "your window was/is X to Y" on a denial.
 */
function nearest(now: Date, candidates: readonly WindowedReservation[]): WindowedReservation | null {
	let best: WindowedReservation | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const distance = Math.min(
			Math.abs(now.getTime() - candidate.window.start.getTime()),
			Math.abs(now.getTime() - candidate.window.end.getTime()),
		);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

function evaluateTeam(
	team: TeamFull,
	tool: string,
	reservations: readonly Reservation[],
	now: Date,
): AccessCheckResult {
	if (!isSupportedTool(tool)) return deny("tool_not_authorized", "team", tool);

	const candidates = windowsFor(team, reservations);
	const active = candidates.find(c => now >= c.window.start && now < c.window.end);
	if (active) {
		return {
			valid: true,
			grant: "team",
			tool,
			user: null,
			team: teamFor(active.reservation.team),
			reservation_id: active.reservation.id,
			window_starts_at: active.window.start.toISOString(),
			window_ends_at: active.window.end.toISOString(),
		};
	}

	const near = nearest(now, candidates);
	return deny("outside_window", "team", tool, {
		team: near ? teamFor(near.reservation.team) : null,
		window: near?.window ?? null,
	});
}

function evaluatePersonal(user: UserEntry, tool: string, now: Date): AccessCheckResult {
	const accessUser = userFor(user);
	// An unapproved account grants nothing, whatever it was asked about.
	if (!isPersonalAccessEligible(user)) return deny("revoked", "personal", tool, { user: accessUser });
	if (!isSupportedTool(tool)) return deny("tool_not_authorized", "personal", tool, { user: accessUser });

	const hours = currentOrNextSiteHours(now);
	if (now >= hours.start && now < hours.end) {
		return {
			valid: true,
			grant: "personal",
			tool,
			user: accessUser,
			team: null,
			reservation_id: null,
			window_starts_at: hours.start.toISOString(),
			window_ends_at: hours.end.toISOString(),
		};
	}

	// Overnight: report when the gate next opens for this link.
	return deny("outside_window", "personal", tool, { user: accessUser, window: hours });
}

/**
 * Decide whether the holder of a token currently has access to the named
 * tool. Pure function over the resolved principal + reservations + clock —
 * the caller owns the token → principal lookup.
 *
 * `undefined` principal means the token matched nothing.
 */
export function evaluateAccess(
	principal: AccessPrincipal | undefined,
	tool: string,
	reservations: readonly Reservation[],
	now: Date = new Date(),
): AccessCheckResult {
	if (!principal) return deny("unknown_token", null, tool);
	if (principal.kind === "team") return evaluateTeam(principal.team, tool, reservations, now);
	return evaluatePersonal(principal.user, tool, now);
}
