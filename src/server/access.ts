import type { Reservation, Team, TeamFull, UserEntry } from "~/types";
import { getReservationWindow } from "./util/slotTime";

/** Tools the scheduler is willing to be asked about. */
export const SUPPORTED_TOOLS = ["gate"] as const;
export type Tool = (typeof SUPPORTED_TOOLS)[number];

/**
 * Grace period applied before the reservation's slot start. Lets teams arrive
 * a little early without being denied.
 */
export const ACCESS_PRE_START_GRACE_MS = 30 * 60 * 1000;

/**
 * Grace period applied after the reservation's slot end. Lets teams stay late
 * (e.g. to lock up, finish driving, load the trailer).
 */
export const ACCESS_POST_END_GRACE_MS = 6 * 60 * 60 * 1000;

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
	user: AccessUser;
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

/**
 * Returns the team numbers the user can act on behalf of. Admins are
 * intentionally treated as having NO automatic gate access — admins manage
 * reservations but aren't necessarily the people at the field. They'd get
 * a code via being on a team like everyone else.
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

function reservationTeamMatchesAny(reservation: Reservation, teams: readonly Team[]): boolean {
	if (reservation.abandoned) return false;
	// Team numbers in reservations are always FRC numbers (numeric); when they come in
	// as strings (from the tRPC input layer) we coerce here.
	const t = typeof reservation.team === "string" ? Number.parseInt(reservation.team, 10) : reservation.team;
	return Number.isFinite(t) && teams.includes(t as Team);
}

/**
 * Find a reservation for one of the user's teams that the given moment
 * falls inside. Returns `{reservation, window}` for the first match, or
 * null if no reservation is currently in-window.
 */
function findActiveReservation(
	now: Date,
	reservations: readonly Reservation[],
	teams: readonly Team[],
): { reservation: Reservation; window: { start: Date; end: Date } } | null {
	for (const reservation of reservations) {
		if (!reservationTeamMatchesAny(reservation, teams)) continue;
		const window = computeAccessWindow(reservation);
		if (!window) continue;
		if (now >= window.start && now < window.end) return { reservation, window };
	}
	return null;
}

/**
 * Find the reservation for one of the user's teams whose window is nearest
 * to `now` (most-recent past or next upcoming, by absolute distance). Used
 * to populate the "your window was X to Y" / "your next window is X to Y"
 * fields on a denial response.
 */
function findNearestReservation(
	now: Date,
	reservations: readonly Reservation[],
	teams: readonly Team[],
): { reservation: Reservation; window: { start: Date; end: Date } } | null {
	let best: { reservation: Reservation; window: { start: Date; end: Date }; distance: number } | null = null;
	for (const reservation of reservations) {
		if (!reservationTeamMatchesAny(reservation, teams)) continue;
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
 * Decide whether the holder of a per-user access token (resolved by the
 * caller to a UserEntry) currently has access to the named tool. Pure
 * function over the supplied user + reservations + clock — the caller
 * (route handler) is responsible for the token → user lookup.
 */
export function evaluateUserAccess(
	user: UserEntry | undefined,
	tool: string,
	reservations: readonly Reservation[],
	now: Date = new Date(),
): AccessCheckResult {
	if (!user) {
		return {
			valid: false,
			reason: "unknown_token",
			tool,
			user: null,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		};
	}

	const accessUser = userFor(user);

	if (user.disabled) {
		return {
			valid: false,
			reason: "revoked",
			tool,
			user: accessUser,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		};
	}

	if (!isSupportedTool(tool)) {
		return {
			valid: false,
			reason: "tool_not_authorized",
			tool,
			user: accessUser,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		};
	}

	const teams = userTeams(user);
	if (teams.length === 0) {
		return {
			valid: false,
			reason: "revoked",
			tool,
			user: accessUser,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		};
	}

	const active = findActiveReservation(now, reservations, teams);
	if (active) {
		return {
			valid: true,
			tool,
			user: accessUser,
			team: teamFor(active.reservation.team),
			reservation_id: active.reservation.id,
			window_starts_at: active.window.start.toISOString(),
			window_ends_at: active.window.end.toISOString(),
		};
	}

	const nearest = findNearestReservation(now, reservations, teams);
	return {
		valid: false,
		reason: "outside_window",
		tool,
		user: accessUser,
		team: nearest ? teamFor(nearest.reservation.team) : null,
		window_starts_at: nearest?.window.start.toISOString() ?? null,
		window_ends_at: nearest?.window.end.toISOString() ?? null,
	};
}
