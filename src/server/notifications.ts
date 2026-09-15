import { env } from "~/env";
import type { Reservation, UserEntry, UserId } from "~/types";
import { isSlackConfigured, SlackApiError, SlackNotConfiguredError, sendDirectMessage } from "./slack";

/**
 * Build the per-user gate access URL. Returns null when GATE_BASE_URL
 * isn't configured (the URL is meaningless without it).
 */
export function gateAccessUrl(accessToken: string | undefined | null): string | null {
	if (!accessToken) return null;
	if (!env.GATE_BASE_URL) return null;
	const base = env.GATE_BASE_URL.replace(/\/+$/, "");
	return `${base}/g/${accessToken}`;
}

function welcomeMessage(user: UserEntry, url: string | null): string {
	const greeting = user.displayName ?? user.name;
	const link = url ?? "(gate URL not configured on the scheduler — ask an admin)";
	return [
		`Hi ${greeting}! 👋`,
		"",
		"You've been enrolled in the practice-field gate access system. Here's your *personal* link to open the gate:",
		"",
		`<${link}>`,
		"",
		"How it works:",
		"• Bookmark the link in your phone's browser. You only need to enroll your browser once for the whole season.",
		"• During one of your team's reserved practice times, opening the link will pulse the gate.",
		"• Outside those times the link will tell you when your next window is.",
		"",
		"Keep this link private — don't share it with people not on your team. If you think it's been compromised, ask an admin to rotate it.",
	].join("\n");
}

export type WelcomeDmOutcome =
	| { sent: true }
	| { sent: false; reason: "slack_not_configured" | "no_slack_id" | "slack_error"; error?: string };

/**
 * DM a user their gate access URL. Best-effort — never throws; on failure
 * returns a structured outcome so the caller can log without breaking the
 * login flow.
 */
export async function sendAccessTokenWelcome(
	user: UserEntry,
	slackUserId: string | null | undefined,
): Promise<WelcomeDmOutcome> {
	if (!isSlackConfigured()) return { sent: false, reason: "slack_not_configured" };
	if (!slackUserId) return { sent: false, reason: "no_slack_id" };

	const text = welcomeMessage(user, gateAccessUrl(user.accessToken));
	try {
		await sendDirectMessage({ slackUserId, text });
		return { sent: true };
	} catch (err) {
		if (err instanceof SlackNotConfiguredError) return { sent: false, reason: "slack_not_configured" };
		if (err instanceof SlackApiError) return { sent: false, reason: "slack_error", error: err.slackError };
		return { sent: false, reason: "slack_error", error: (err as Error).message };
	}
}

function reservationNoticeMessage(reservation: Reservation, recipient: UserEntry): string {
	const lines = [
		`New practice-field reservation for *Team ${reservation.team}*:`,
		`• Date: ${reservation.date}`,
		`• Slot: ${reservation.slot}`,
	];
	if (reservation.notes) lines.push(`• Notes: ${reservation.notes}`);
	const url = gateAccessUrl(recipient.accessToken);
	if (url) {
		lines.push("");
		lines.push(`Your personal gate link: <${url}>`);
		lines.push("(Use it during the reservation window to open the gate.)");
	}
	return lines.join("\n");
}

export type ReservationDmRecipient = {
	user: UserEntry;
	slackUserId: string;
};

/**
 * Pure selector for "who should we DM about this reservation?". Pulled out
 * of the backend so it can be unit-tested in isolation. Returns one entry
 * per (team-member-on-this-team, slackId) pair, excluding the creator,
 * disabled users, and admins (admins manage but don't need every team's
 * reservation reminders DM'd to them).
 *
 * Returns an empty list (with a synthetic `skipReason`) if the reservation
 * has a non-numeric team, since this branch's user.teams are always
 * numeric and there'd be no possible match.
 */
export function selectReservationDmRecipients(
	users: readonly UserEntry[],
	slackMappings: readonly { slackId: string; userId: UserId }[],
	reservation: Reservation,
	excludeUserId: UserId,
): { recipients: ReservationDmRecipient[]; skipReason?: "non_numeric_team" } {
	const teamKey =
		typeof reservation.team === "string" ? Number.parseInt(reservation.team, 10) : (reservation.team as number);
	if (!Number.isFinite(teamKey)) return { recipients: [], skipReason: "non_numeric_team" };

	const recipients: ReservationDmRecipient[] = [];
	for (const user of users) {
		if (user.id === excludeUserId) continue;
		if (user.disabled) continue;
		if (user.teams === "admin") continue;
		if (!user.teams.includes(teamKey)) continue;
		for (const mapping of slackMappings) {
			if (mapping.userId !== user.id) continue;
			recipients.push({ user, slackUserId: mapping.slackId });
		}
	}
	return { recipients };
}

export type ReservationDmOutcome = {
	userId: string;
	slackUserId: string;
	sent: boolean;
	reason?: "slack_not_configured" | "slack_error";
	error?: string;
};

/**
 * DM every recipient about the given reservation. Best-effort — per-recipient
 * failures are reported in the returned outcomes rather than thrown. Returns
 * an empty array if Slack isn't configured.
 */
export async function notifyTeamOfReservation(
	reservation: Reservation,
	recipients: readonly ReservationDmRecipient[],
): Promise<ReservationDmOutcome[]> {
	if (recipients.length === 0) return [];
	if (!isSlackConfigured()) {
		return recipients.map(r => ({
			userId: r.user.id,
			slackUserId: r.slackUserId,
			sent: false,
			reason: "slack_not_configured",
		}));
	}

	const outcomes: ReservationDmOutcome[] = [];
	for (const recipient of recipients) {
		const text = reservationNoticeMessage(reservation, recipient.user);
		try {
			await sendDirectMessage({ slackUserId: recipient.slackUserId, text });
			outcomes.push({ userId: recipient.user.id, slackUserId: recipient.slackUserId, sent: true });
		} catch (err) {
			const isApi = err instanceof SlackApiError;
			outcomes.push({
				userId: recipient.user.id,
				slackUserId: recipient.slackUserId,
				sent: false,
				reason: "slack_error",
				error: isApi ? err.slackError : (err as Error).message,
			});
		}
	}
	return outcomes;
}
