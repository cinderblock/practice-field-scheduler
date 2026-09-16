import type { Reservation, Team, TeamFull, UserEntry } from "~/types";
import { getReservationWindow } from "./util/slotTime";

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

export type AccessTeam = {
	id: string;
	name: string;
};

export type AccessUser = {
	id: string;
	name: string;
};

export type AccessCheckSuccess = {
	valid: true;
	tool: string;
	/**
	 * Which person opened the tool. Always `null` under the current per-team
	 * token model — the link is shared, so the scheduler genuinely doesn't
	 * know who clicked. Kept in the envelope because per-user tokens remain
	 * a live option (see `evaluateUserAccess`).
	 */
	user: AccessUser | null;
	team: AccessTeam;
	reservation_id: string;
	window_starts_at: string;
	window_ends_at: string;
};

export type AccessCheckDenialReason = "outside_window" | "unknown_token" | "revoked" | "tool_not_authorized";

export type AccessCheckDenial = {
	valid: false;
	reason: AccessCheckDenialReason;
	tool: string;
	user: AccessUser | null;
	team: AccessTeam | null;
	window_starts_at: string | null;
	window_ends_at: string | null;
};

export type AccessCheckResult = AccessCheckSuccess | AccessCheckDenial;

/**
 * Whatever the presented token resolved to.
 *
 * `team` is what's in use today (one shared link per team). `user` is the
 * alternative model — kept implemented and tested so switching back is a
 * lookup change in `backend.ts`, not a rewrite. See
 * `plans/gate-access-integration.md` for why per-team won.
 */
export type AccessPrincipal = { kind: "team"; team: TeamFull } | { kind: "user"; user: UserEntry };

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
	tool: string,
	user: AccessUser | null = null,
	team: AccessTeam | null = null,
	window: { start: Date; end: Date } | null = null,
): AccessCheckDenial {
	return {
		valid: false,
		reason,
		tool,
		user,
		team,
		window_starts_at: window?.start.toISOString() ?? null,
		window_ends_at: window?.end.toISOString() ?? null,
	};
}

/**
 * Returns the team numbers a user can act on behalf of. Admins are
 * intentionally treated as having NO automatic access — admins manage
 * reservations but aren't necessarily the people at the field. They'd get
 * access via team membership like everyone else.
 */
function userTeams(user: UserEntry): readonly Team[] {
	if (user.teams === "admin") return [];
	return user.teams;
}

/**
 * Compute the absolute access window for a reservation (slot bounds padded
 * by the pre-start / post-end grace).
 */
export function computeAccessWindow(reservation: Reservation): { start: Date; end: Date } | null {
	const slot = getReservationWindow(reservation.date, reservation.slot);
	if (!slot) return null;
	return {
		start: new Date(slot.start.getTime() - ACCESS_PRE_START_GRACE_MS),
		end: new Date(slot.end.getTime() + ACCESS_POST_END_GRACE_MS),
	};
}

/**
 * Normalize a reservation's team for comparison. Team numbers arriving from
 * the tRPC input layer can be numeric strings; house/special teams are
 * genuinely non-numeric and compare as strings.
 */
function sameTeam(a: TeamFull, b: TeamFull): boolean {
	const na = typeof a === "string" ? Number.parseInt(a, 10) : a;
	const nb = typeof b === "string" ? Number.parseInt(b, 10) : b;
	if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
	return String(a).trim() === String(b).trim();
}

function reservationMatchesAny(reservation: Reservation, teams: readonly TeamFull[]): boolean {
	if (reservation.abandoned) return false;
	return teams.some(t => sameTeam(reservation.team, t));
}

/**
 * Find a reservation for one of the given teams that `now` falls inside.
 */
function findActiveReservation(
	now: Date,
	reservations: readonly Reservation[],
	teams: readonly TeamFull[],
): { reservation: Reservation; window: { start: Date; end: Date } } | null {
	for (const reservation of reservations) {
		if (!reservationMatchesAny(reservation, teams)) continue;
		const window = computeAccessWindow(reservation);
		if (!window) continue;
		if (now >= window.start && now < window.end) return { reservation, window };
	}
	return null;
}

/**
 * Find the reservation whose window is nearest to `now` (most-recent past or
 * next upcoming, by absolute distance). Used to populate the "your window was
 * X to Y" / "your next window is X to Y" fields on a denial.
 */
function findNearestReservation(
	now: Date,
	reservations: readonly Reservation[],
	teams: readonly TeamFull[],
): { reservation: Reservation; window: { start: Date; end: Date } } | null {
	let best: { reservation: Reservation; window: { start: Date; end: Date }; distance: number } | null = null;
	for (const reservation of reservations) {
		if (!reservationMatchesAny(reservation, teams)) continue;
		const window = computeAccessWindow(reservation);
		if (!window) continue;
		const distance = Math.min(
			Math.abs(now.getTime() - window.start.getTime()),
			Math.abs(now.getTime() - window.end.getTime()),
		);
		if (!best || distance < best.distance) best = { reservation, window, distance };
	}
	if (!best) return null;
	return { reservation: best.reservation, window: best.window };
}

/**
 * Shared policy core: given the teams a caller may act for, decide whether
 * the named tool is open to them right now.
 */
function evaluateForTeams(
	teams: readonly TeamFull[],
	tool: string,
	reservations: readonly Reservation[],
	now: Date,
	user: AccessUser | null,
): AccessCheckResult {
	if (!isSupportedTool(tool)) return deny("tool_not_authorized", tool, user);
	if (teams.length === 0) return deny("revoked", tool, user);

	const active = findActiveReservation(now, reservations, teams);
	if (active) {
		return {
			valid: true,
			tool,
			user,
			team: teamFor(active.reservation.team),
			reservation_id: active.reservation.id,
			window_starts_at: active.window.start.toISOString(),
			window_ends_at: active.window.end.toISOString(),
		};
	}

	const nearest = findNearestReservation(now, reservations, teams);
	return deny(
		"outside_window",
		tool,
		user,
		nearest ? teamFor(nearest.reservation.team) : null,
		nearest?.window ?? null,
	);
}

/**
 * Decide whether the holder of a token currently has access to the named
 * tool. Pure function over the resolved principal + reservations + clock —
 * the caller (route handler) owns the token → principal lookup.
 *
 * `undefined` principal means the token matched nothing.
 */
export function evaluateAccess(
	principal: AccessPrincipal | undefined,
	tool: string,
	reservations: readonly Reservation[],
	now: Date = new Date(),
): AccessCheckResult {
	if (!principal) return deny("unknown_token", tool);

	if (principal.kind === "team") {
		return evaluateForTeams([principal.team], tool, reservations, now, null);
	}

	const { user } = principal;
	const accessUser = userFor(user);
	// A disabled account grants nothing, whatever it was asked about.
	if (user.disabled) return deny("revoked", tool, accessUser);
	return evaluateForTeams(userTeams(user), tool, reservations, now, accessUser);
}

/**
 * Per-team convenience wrapper — the model in use today.
 */
export function evaluateTeamAccess(
	team: TeamFull | undefined,
	tool: string,
	reservations: readonly Reservation[],
	now: Date = new Date(),
): AccessCheckResult {
	return evaluateAccess(team === undefined ? undefined : { kind: "team", team }, tool, reservations, now);
}

/**
 * Per-user convenience wrapper. Not on the live path today, but kept
 * implemented and tested so per-user tokens can be reinstated by changing
 * the token lookup in `backend.ts` rather than rewriting policy.
 */
export function evaluateUserAccess(
	user: UserEntry | undefined,
	tool: string,
	reservations: readonly Reservation[],
	now: Date = new Date(),
): AccessCheckResult {
	return evaluateAccess(user === undefined ? undefined : { kind: "user", user }, tool, reservations, now);
}
