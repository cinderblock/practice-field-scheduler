import type { Reservation, TeamFull } from "~/types";
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

export type AccessCheckSuccess = {
	valid: true;
	tool: string;
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
	team: AccessTeam | null;
	window_starts_at: string | null;
	window_ends_at: string | null;
};

export type AccessCheckResult = AccessCheckSuccess | AccessCheckDenial;

function teamFor(team: TeamFull): AccessTeam {
	const id = team.toString();
	return { id, name: `Team ${id}` };
}

function isSupportedTool(tool: string): tool is Tool {
	return (SUPPORTED_TOOLS as readonly string[]).includes(tool);
}

/**
 * Determine whether a reservation grants the given tool access right now.
 * The caller (route handler) is responsible for resolving a token to a
 * reservation; this function does the policy logic.
 *
 * `now` is injectable for tests.
 */
export function evaluateAccess(
	reservation: Reservation | undefined,
	tool: string,
	now: Date = new Date(),
): AccessCheckResult {
	if (!reservation) {
		return {
			valid: false,
			reason: "unknown_token",
			tool,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		};
	}

	const window = computeAccessWindow(reservation);
	const team = teamFor(reservation.team);
	const windowStart = window?.start.toISOString() ?? null;
	const windowEnd = window?.end.toISOString() ?? null;

	if (reservation.abandoned) {
		return {
			valid: false,
			reason: "revoked",
			tool,
			team,
			window_starts_at: windowStart,
			window_ends_at: windowEnd,
		};
	}

	if (!isSupportedTool(tool)) {
		return {
			valid: false,
			reason: "tool_not_authorized",
			tool,
			team,
			window_starts_at: windowStart,
			window_ends_at: windowEnd,
		};
	}

	if (!window) {
		// Reservation row is corrupt — treat as outside any window so the
		// caller surfaces a denial rather than a 500.
		return {
			valid: false,
			reason: "outside_window",
			tool,
			team,
			window_starts_at: null,
			window_ends_at: null,
		};
	}

	if (now < window.start || now >= window.end) {
		return {
			valid: false,
			reason: "outside_window",
			tool,
			team,
			window_starts_at: windowStart,
			window_ends_at: windowEnd,
		};
	}

	return {
		valid: true,
		tool,
		team,
		reservation_id: reservation.id,
		// biome-ignore lint/style/noNonNullAssertion: windowStart is non-null when window is non-null
		window_starts_at: windowStart!,
		// biome-ignore lint/style/noNonNullAssertion: windowEnd is non-null when window is non-null
		window_ends_at: windowEnd!,
	};
}

/**
 * Slot bounds, padded by the configured pre-start and post-end grace periods.
 */
export function computeAccessWindow(reservation: Reservation): { start: Date; end: Date } | null {
	const slot = getReservationWindow(reservation.date, reservation.slot);
	if (!slot) return null;
	return {
		start: new Date(slot.start.getTime() - ACCESS_PRE_START_GRACE_MS),
		end: new Date(slot.end.getTime() + ACCESS_POST_END_GRACE_MS),
	};
}
