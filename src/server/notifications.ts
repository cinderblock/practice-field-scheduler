import { env } from "~/env";
import type { Reservation, TeamFull, UserEntry, UserId } from "~/types";
import { isSlackConfigured, SlackApiError, SlackNotConfiguredError, sendDirectMessage } from "./slack";

/**
 * Build a team's gate access URL. Returns null when GATE_BASE_URL isn't
 * configured (the URL is meaningless without it).
 */
export function gateAccessUrl(token: string | undefined | null): string | null {
	if (!token) return null;
	if (!env.GATE_BASE_URL) return null;
	const base = env.GATE_BASE_URL.replace(/\/+$/, "");
	return `${base}/g/${token}`;
}

export type DmOutcome =
	| { sent: true }
	| { sent: false; reason: "slack_not_configured" | "no_slack_id" | "slack_error"; error?: string };

/** Why a team is being sent its link. Changes only the framing of the message. */
export type LinkDmKind = "issued" | "rotated";

function teamLinkMessage(team: TeamFull, url: string | null, kind: LinkDmKind): string {
	const link = url ?? "(gate URL not configured on the scheduler — ask an admin)";

	const opening =
		kind === "rotated"
			? [
					`Team ${team}'s practice-field gate link has been *rotated*. 🔄`,
					"",
					"The previous link no longer works — please replace your bookmark with this one:",
				]
			: [
					`Here's Team ${team}'s practice-field gate link. 🔑`,
					"",
					"This is your team's shared link for opening the gate:",
				];

	return [
		...opening,
		"",
		`<${link}>`,
		"",
		"How it works:",
		"• Bookmark it on your phone — one link works all season.",
		"• During your team's reserved practice time it will open the gate.",
		"• Outside those times it will tell you when your next window is.",
		"",
		"It's shared by everyone on your team, so keep it within the team. If it gets out, ask an admin to rotate it.",
	].join("\n");
}

/**
 * DM one user their team's gate link. Best-effort — never throws; returns a
 * structured outcome so callers can log without breaking the login flow.
 */
export async function sendTeamLinkDm(
	_user: UserEntry,
	slackUserId: string | null | undefined,
	team: TeamFull,
	token: string,
	kind: LinkDmKind = "issued",
): Promise<DmOutcome> {
	if (!isSlackConfigured()) return { sent: false, reason: "slack_not_configured" };
	if (!slackUserId) return { sent: false, reason: "no_slack_id" };

	try {
		await sendDirectMessage({ slackUserId, text: teamLinkMessage(team, gateAccessUrl(token), kind) });
		return { sent: true };
	} catch (err) {
		if (err instanceof SlackNotConfiguredError) return { sent: false, reason: "slack_not_configured" };
		if (err instanceof SlackApiError) return { sent: false, reason: "slack_error", error: err.slackError };
		return { sent: false, reason: "slack_error", error: (err as Error).message };
	}
}

function reservationNoticeMessage(reservation: Reservation, token: string | undefined): string {
	const lines = [
		`New practice-field reservation for *Team ${reservation.team}*:`,
		`• Date: ${reservation.date}`,
		`• Slot: ${reservation.slot}`,
	];
	if (reservation.notes) lines.push(`• Notes: ${reservation.notes}`);
	const url = gateAccessUrl(token);
	if (url) {
		lines.push("");
		lines.push(`Your team's gate link: <${url}>`);
		lines.push("(Use it during the reservation window to open the gate.)");
	}
	return lines.join("\n");
}

export type TeamMemberRecipient = {
	user: UserEntry;
	slackUserId: string;
};

/**
 * Pure selector for "who's on this team that we can DM?". Pulled out of the
 * backend so it can be unit-tested in isolation. Returns one entry per
 * (team-member, slackId) pair, excluding disabled users and admins (admins
 * manage but don't need every team's traffic DM'd to them).
 *
 * Pass `excludeUserId` to skip one person — e.g. the creator of a reservation,
 * who already knows. Pass `null` to include everyone, as rotation does.
 */
export function selectTeamMemberRecipients(
	users: readonly UserEntry[],
	slackMappings: readonly { slackId: string; userId: UserId }[],
	team: TeamFull,
	excludeUserId: UserId | null,
): { recipients: TeamMemberRecipient[] } {
	const wanted = typeof team === "string" ? Number.parseInt(team, 10) : team;

	const recipients: TeamMemberRecipient[] = [];
	for (const user of users) {
		if (excludeUserId !== null && user.id === excludeUserId) continue;
		if (user.disabled) continue;
		if (user.teams === "admin") continue;
		const onTeam = user.teams.some(t =>
			Number.isFinite(wanted) ? t === wanted : String(t).trim() === String(team).trim(),
		);
		if (!onTeam) continue;
		for (const mapping of slackMappings) {
			if (mapping.userId !== user.id) continue;
			recipients.push({ user, slackUserId: mapping.slackId });
		}
	}
	return { recipients };
}

export type TeamDmOutcome = {
	userId: string;
	slackUserId: string;
	sent: boolean;
	reason?: "slack_not_configured" | "slack_error";
	error?: string;
};

async function fanOut(
	recipients: readonly TeamMemberRecipient[],
	text: (recipient: TeamMemberRecipient) => string,
): Promise<TeamDmOutcome[]> {
	if (recipients.length === 0) return [];
	if (!isSlackConfigured()) {
		return recipients.map(r => ({
			userId: r.user.id,
			slackUserId: r.slackUserId,
			sent: false,
			reason: "slack_not_configured" as const,
		}));
	}

	const outcomes: TeamDmOutcome[] = [];
	for (const recipient of recipients) {
		try {
			await sendDirectMessage({ slackUserId: recipient.slackUserId, text: text(recipient) });
			outcomes.push({ userId: recipient.user.id, slackUserId: recipient.slackUserId, sent: true });
		} catch (err) {
			outcomes.push({
				userId: recipient.user.id,
				slackUserId: recipient.slackUserId,
				sent: false,
				reason: "slack_error",
				error: err instanceof SlackApiError ? err.slackError : (err as Error).message,
			});
		}
	}
	return outcomes;
}

/**
 * DM every recipient about the given reservation, including the team's gate
 * link when there is one. Best-effort — per-recipient failures are reported in
 * the returned outcomes rather than thrown.
 */
export async function notifyTeamOfReservation(
	reservation: Reservation,
	recipients: readonly TeamMemberRecipient[],
	token: string | undefined,
): Promise<TeamDmOutcome[]> {
	const text = reservationNoticeMessage(reservation, token);
	return fanOut(recipients, () => text);
}

/**
 * DM every recipient a team's gate link — used after a rotation, where every
 * existing bookmark has just stopped working.
 */
export async function notifyTeamOfLink(
	team: TeamFull,
	token: string,
	recipients: readonly TeamMemberRecipient[],
	kind: LinkDmKind,
): Promise<TeamDmOutcome[]> {
	const text = teamLinkMessage(team, gateAccessUrl(token), kind);
	return fanOut(recipients, () => text);
}
