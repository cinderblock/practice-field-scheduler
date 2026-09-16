import { env } from "~/env";
import type { Reservation, TeamFull, UserEntry, UserId } from "~/types";
import { describeSiteHours, formatHour, SITE_CLOSE_HOUR, SITE_OPEN_HOUR, sameTeam } from "./access";
import { isSlackConfigured, SlackApiError, SlackNotConfiguredError, sendDirectMessage } from "./slack";

/**
 * Build a gate access URL (team or personal — same shape). Returns null when
 * GATE_BASE_URL isn't configured (the URL is meaningless without it).
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

/** One link to deliver. */
export type GateLink = { kind: "personal"; token: string } | { kind: "team"; team: TeamFull; token: string };

/** Why links are being sent. Changes only the framing of the message. */
export type LinkDmKind = "issued" | "approved" | "rotated";

const NOT_CONFIGURED = "(gate URL not configured on the scheduler — ask an admin)";

function linkLine(link: GateLink): string[] {
	const url = gateAccessUrl(link.token) ?? NOT_CONFIGURED;
	if (link.kind === "personal") {
		return [
			`*Your personal link* — works any day, ${describeSiteHours()}. It's yours alone: don't share it.`,
			`<${url}>`,
		];
	}
	return [
		`*Team ${link.team}'s link* — works around Team ${link.team}'s reserved practice times. Share it with your team.`,
		`<${url}>`,
	];
}

/**
 * Build the DM text for one or more links. Exported for tests.
 */
export function linksMessage(links: readonly GateLink[], kind: LinkDmKind): string {
	const plural = links.length > 1;
	const opening =
		kind === "rotated"
			? [
					`Your practice-field gate link${plural ? "s have" : " has"} been *replaced*. 🔄`,
					`The old link${plural ? "s no longer work" : " no longer works"} — please update your bookmark${plural ? "s" : ""}.`,
				]
			: kind === "approved"
				? ["You've been approved for general gate access at the practice field. 🔑"]
				: [`Here ${plural ? "are your practice-field gate links" : "is your practice-field gate link"}. 🔑`];

	const body = links.flatMap(link => ["", ...linkLine(link)]);

	return [
		...opening,
		...body,
		"",
		plural
			? "Bookmark them on your phone — they work all season. Outside their hours they'll tell you when they next open."
			: "Bookmark it on your phone — it works all season. Outside its hours it'll tell you when it next opens.",
		`No link opens the gate between ${formatHour(SITE_CLOSE_HOUR)} and ${formatHour(SITE_OPEN_HOUR)}.`,
		"If a link gets out, ask an admin to replace it.",
	].join("\n");
}

/**
 * DM one Slack account some gate links, in a single message. Best-effort —
 * never throws; returns a structured outcome so callers can log without
 * breaking the login flow.
 */
export async function sendLinksDm(
	slackUserId: string | null | undefined,
	links: readonly GateLink[],
	kind: LinkDmKind,
): Promise<DmOutcome> {
	if (!isSlackConfigured()) return { sent: false, reason: "slack_not_configured" };
	if (!slackUserId) return { sent: false, reason: "no_slack_id" };

	try {
		await sendDirectMessage({ slackUserId, text: linksMessage(links, kind) });
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
	const recipients: TeamMemberRecipient[] = [];
	for (const user of users) {
		if (excludeUserId !== null && user.id === excludeUserId) continue;
		if (user.disabled) continue;
		if (user.teams === "admin") continue;
		if (!user.teams.some(t => sameTeam(t, team))) continue;
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
 * DM every recipient a team's replacement link after a rotation, where every
 * existing bookmark has just stopped working.
 */
export async function notifyTeamOfLink(
	team: TeamFull,
	token: string,
	recipients: readonly TeamMemberRecipient[],
): Promise<TeamDmOutcome[]> {
	const text = linksMessage([{ kind: "team", team, token }], "rotated");
	return fanOut(recipients, () => text);
}
