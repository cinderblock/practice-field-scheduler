import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Reservation, UserEntry } from "~/types";

const { envState } = vi.hoisted(() => ({
	envState: {
		GATE_BASE_URL: "https://gate.example.test" as string | undefined,
		SLACK_BOT_TOKEN: "xoxb-test-token" as string | undefined,
	},
}));

vi.mock("~/env", () => ({
	env: envState,
}));

const {
	gateAccessUrl,
	linksMessage,
	nameFixMessage,
	notifyTeamOfLink,
	notifyTeamOfReservation,
	selectTeamMemberRecipients,
	sendLinksDm,
	sendNameFixDm,
} = await import("~/server/notifications");
const { checkSlackNames } = await import("~/server/util/slackName");

const fetchMock = vi.fn();

beforeEach(() => {
	envState.GATE_BASE_URL = "https://gate.example.test";
	envState.SLACK_BOT_TOKEN = "xoxb-test-token";
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

const user: UserEntry = {
	id: "user-1",
	name: "Jane Doe",
	displayName: "Jane Doe (1234)",
	created: new Date("2026-05-01T00:00:00Z"),
	updated: new Date("2026-05-01T00:00:00Z"),
	teams: [1234],
	email: "jane@example.com",
	image: "",
	slackNamesSyncedAt: new Date("2026-05-01T00:00:00Z"),
};

/** Read the JSON body of the nth captured fetch call. */
function bodyOf(call = 0): { channel: string; text: string } {
	const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
	return JSON.parse(init.body as string);
}

describe("gateAccessUrl", () => {
	it("builds the URL when both inputs are present", () => {
		expect(gateAccessUrl("abc")).toBe("https://gate.example.test/g/abc");
	});

	it("trims trailing slashes from GATE_BASE_URL", () => {
		envState.GATE_BASE_URL = "https://gate.example.test/";
		expect(gateAccessUrl("abc")).toBe("https://gate.example.test/g/abc");
	});

	it("returns null when the token is missing", () => {
		expect(gateAccessUrl(undefined)).toBeNull();
		expect(gateAccessUrl("")).toBeNull();
	});

	it("returns null when GATE_BASE_URL isn't configured", () => {
		envState.GATE_BASE_URL = undefined;
		expect(gateAccessUrl("abc")).toBeNull();
	});
});

describe("linksMessage", () => {
	it("describes a personal link as private and bounded by site hours", () => {
		const text = linksMessage([{ kind: "personal", token: "tok-me" }], "issued");
		expect(text).toContain("https://gate.example.test/g/tok-me");
		expect(text).toContain("personal link");
		expect(text).toContain("8am–11pm");
		expect(text).toContain("don't share");
	});

	it("describes a team link as shared and tied to reservations", () => {
		const text = linksMessage([{ kind: "team", team: 1234, token: "tok-team" }], "issued");
		expect(text).toContain("https://gate.example.test/g/tok-team");
		expect(text).toContain("Team 1234");
		expect(text).toContain("reserved practice times");
		expect(text).toContain("Share it with your team");
	});

	it("puts every link a multi-team mentor is owed in one message", () => {
		const text = linksMessage(
			[
				{ kind: "personal", token: "tok-me" },
				{ kind: "team", team: 1234, token: "tok-a" },
				{ kind: "team", team: 5678, token: "tok-b" },
			],
			"issued",
		);
		expect(text).toContain("gate links");
		expect(text).toContain("/g/tok-me");
		expect(text).toContain("/g/tok-a");
		expect(text).toContain("/g/tok-b");
		expect(text).toContain("Bookmark them");
	});

	it("says when nothing opens the gate", () => {
		expect(linksMessage([{ kind: "personal", token: "t" }], "issued")).toContain("between 11pm and 8am");
	});

	it("frames an approval as newly granted general gate access", () => {
		const text = linksMessage([{ kind: "personal", token: "tok-new" }], "approved");
		expect(text).toContain("approved for general gate access");
		expect(text).toContain("/g/tok-new");
		expect(text).not.toContain("no longer works");
	});

	it("frames a rotation as a replacement and warns the old link is dead", () => {
		const text = linksMessage([{ kind: "personal", token: "tok-new" }], "rotated");
		expect(text).toContain("replaced");
		expect(text).toContain("no longer works");
		expect(text).toContain("Bookmark it");
	});

	it("falls back to a placeholder when the gate URL isn't configured", () => {
		envState.GATE_BASE_URL = undefined;
		const text = linksMessage([{ kind: "personal", token: "tok" }], "issued");
		expect(text).toContain("(gate URL not configured");
		expect(text).not.toContain("https://");
	});
});

describe("sendLinksDm", () => {
	it("sends one DM to the given Slack account", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, channel: "D1", ts: "0" })));
		const result = await sendLinksDm(
			"U999",
			[
				{ kind: "personal", token: "tok-me" },
				{ kind: "team", team: 1234, token: "tok-team" },
			],
			"issued",
		);
		expect(result).toEqual({ sent: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(bodyOf().channel).toBe("U999");
		expect(bodyOf().text).toContain("/g/tok-me");
		expect(bodyOf().text).toContain("/g/tok-team");
	});

	it("returns slack_not_configured when SLACK_BOT_TOKEN is unset", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		expect(await sendLinksDm("U999", [{ kind: "personal", token: "t" }], "issued")).toEqual({
			sent: false,
			reason: "slack_not_configured",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns no_slack_id when the slack ID is missing", async () => {
		expect(await sendLinksDm(null, [{ kind: "personal", token: "t" }], "issued")).toEqual({
			sent: false,
			reason: "no_slack_id",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns slack_error when chat.postMessage fails", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "user_not_found" })));
		expect(await sendLinksDm("U999", [{ kind: "personal", token: "t" }], "issued")).toEqual({
			sent: false,
			reason: "slack_error",
			error: "user_not_found",
		});
	});
});

describe("notifyTeamOfReservation", () => {
	const reservation: Reservation = {
		id: "res-1",
		date: "2026-05-23",
		slot: "10:00am",
		created: new Date("2026-05-20T00:00:00Z"),
		userId: "user-creator",
		priority: false,
		team: 1234,
		notes: "Bring batteries",
	};

	const otherTeammate: UserEntry = { ...user, id: "user-2", name: "Alex Doe", displayName: "Alex Doe (1234)" };

	it("DMs every recipient with the shared team link", async () => {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, channel: "D1", ts: "0" })));
		const outcomes = await notifyTeamOfReservation(
			reservation,
			[
				{ user, slackUserId: "U111", withLink: true },
				{ user: otherTeammate, slackUserId: "U222", withLink: true },
			],
			"tok-team-1234",
		);
		expect(outcomes).toHaveLength(2);
		expect(outcomes.every(o => o.sent)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		expect(bodyOf(0).channel).toBe("U111");
		expect(bodyOf(0).text).toContain("Team 1234");
		expect(bodyOf(0).text).toContain("https://gate.example.test/g/tok-team-1234");
		expect(bodyOf(0).text).toContain("Bring batteries");
		// Same shared link for the whole team.
		expect(bodyOf(1).channel).toBe("U222");
		expect(bodyOf(1).text).toContain("https://gate.example.test/g/tok-team-1234");
	});

	it("still sends the reservation details when the team has no link yet", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
		const outcomes = await notifyTeamOfReservation(
			reservation,
			[{ user, slackUserId: "U111", withLink: true }],
			undefined,
		);
		expect(outcomes[0]?.sent).toBe(true);
		expect(bodyOf().text).toContain("Team 1234");
		expect(bodyOf().text).not.toContain("gate link");
	});

	it("returns no-DM outcomes when slack is not configured (doesn't call fetch)", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		const outcomes = await notifyTeamOfReservation(reservation, [{ user, slackUserId: "U111", withLink: true }], "tok");
		expect(outcomes).toEqual([{ userId: "user-1", slackUserId: "U111", sent: false, reason: "slack_not_configured" }]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns [] when there are no recipients (doesn't probe slack config)", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		expect(await notifyTeamOfReservation(reservation, [], "tok")).toEqual([]);
	});

	it("reports per-recipient failures without aborting the batch", async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "user_not_found" })));
		const outcomes = await notifyTeamOfReservation(
			reservation,
			[
				{ user, slackUserId: "U111", withLink: true },
				{ user: otherTeammate, slackUserId: "U222", withLink: true },
			],
			"tok",
		);
		expect(outcomes[0]?.sent).toBe(true);
		expect(outcomes[1]).toMatchObject({ sent: false, reason: "slack_error", error: "user_not_found" });
	});
});

describe("notifyTeamOfReservation for people whose names need fixing", () => {
	const reservation: Reservation = {
		id: "res-2",
		date: "2026-05-24",
		slot: "10:00am",
		created: new Date("2026-05-20T00:00:00Z"),
		userId: "user-creator",
		priority: false,
		team: 1234,
	};

	it("still tells them about the booking, but leaves the link out", async () => {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
		await notifyTeamOfReservation(
			reservation,
			[
				{ user, slackUserId: "U111", withLink: true },
				{ user: { ...user, id: "user-2" }, slackUserId: "U222", withLink: false },
			],
			"tok-team",
		);
		expect(bodyOf(0).text).toContain("/g/tok-team");
		expect(bodyOf(1).text).toContain("Team 1234");
		expect(bodyOf(1).text).not.toContain("/g/tok-team");
		expect(bodyOf(1).text).toContain("Slack names need fixing");
	});
});

describe("notifyTeamOfLink", () => {
	it("DMs the whole team the rotated link", async () => {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
		const outcomes = await notifyTeamOfLink(1234, "tok-rotated", [
			{ user, slackUserId: "U111", withLink: true },
			{ user: { ...user, id: "user-2" }, slackUserId: "U222", withLink: true },
		]);
		expect(outcomes.every(o => o.sent)).toBe(true);
		expect(bodyOf(0).text).toContain("https://gate.example.test/g/tok-rotated");
		expect(bodyOf(0).text).toContain("no longer works");
		expect(bodyOf(1).text).toContain("https://gate.example.test/g/tok-rotated");
	});

	it("skips people whose names need fixing: the message is only the link", async () => {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
		const outcomes = await notifyTeamOfLink(1234, "tok-rotated", [
			{ user, slackUserId: "U111", withLink: true },
			{ user: { ...user, id: "user-2" }, slackUserId: "U222", withLink: false },
		]);
		expect(outcomes.map(o => o.slackUserId)).toEqual(["U111"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("reports slack_not_configured rather than throwing", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		const outcomes = await notifyTeamOfLink(1234, "tok", [{ user, slackUserId: "U111", withLink: true }]);
		expect(outcomes).toEqual([{ userId: "user-1", slackUserId: "U111", sent: false, reason: "slack_not_configured" }]);
	});
});

describe("selectTeamMemberRecipients", () => {
	const creator: UserEntry = { ...user, id: "creator" };
	const teammate: UserEntry = { ...user, id: "teammate-1" };
	const otherTeam: UserEntry = { ...user, id: "other-team", teams: [9999] };
	const adminUser: UserEntry = { ...user, id: "admin", teams: "admin" };
	const disabledMember: UserEntry = { ...user, id: "disabled", disabled: true };
	const teammateNoSlack: UserEntry = { ...user, id: "no-slack" };
	const teammateMultiSlack: UserEntry = { ...user, id: "multi-slack" };

	const allUsers: UserEntry[] = [
		creator,
		teammate,
		otherTeam,
		adminUser,
		disabledMember,
		teammateNoSlack,
		teammateMultiSlack,
	];
	const mappings = [
		{ slackId: "U_creator", userId: "creator" },
		{ slackId: "U_teammate", userId: "teammate-1" },
		{ slackId: "U_other", userId: "other-team" },
		{ slackId: "U_admin", userId: "admin" },
		{ slackId: "U_disabled", userId: "disabled" },
		// no-slack: deliberately no mapping
		{ slackId: "U_multi_a", userId: "multi-slack" },
		{ slackId: "U_multi_b", userId: "multi-slack" },
	];

	it("includes team members with a slack mapping, excluding the named user", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, 1234, "creator");
		expect(recipients.map(r => r.slackUserId).sort()).toEqual(["U_multi_a", "U_multi_b", "U_teammate"]);
	});

	it("includes everyone when no one is excluded (the rotation case)", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, 1234, null);
		expect(recipients.map(r => r.slackUserId).sort()).toEqual(["U_creator", "U_multi_a", "U_multi_b", "U_teammate"]);
	});

	it("excludes users on a different team", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, 1234, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("other-team");
	});

	it("excludes admin users", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, 1234, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("admin");
	});

	it("excludes disabled users", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, 1234, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("disabled");
	});

	it("skips users with no Slack mapping silently", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, 1234, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("no-slack");
	});

	it("creates one recipient per (user, slackId) pair when a user has multiple mappings", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, 1234, "creator");
		const multi = recipients
			.filter(r => r.user.id === "multi-slack")
			.map(r => r.slackUserId)
			.sort();
		expect(multi).toEqual(["U_multi_a", "U_multi_b"]);
	});

	it("coerces a numeric-string team to its number", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, "1234", "creator");
		expect(recipients.length).toBeGreaterThan(0);
		expect(recipients.every(r => r.user.teams !== "admin" && (r.user.teams as number[]).includes(1234))).toBe(true);
	});

	it("returns nobody for a non-numeric team when members are numeric", () => {
		const { recipients } = selectTeamMemberRecipients(allUsers, mappings, "not-a-number", "creator");
		expect(recipients).toEqual([]);
	});

	it("keeps people whose names need fixing, but marks them as not getting the link", () => {
		const wrongNames: UserEntry = { ...user, id: "wrong", name: "Jane Doe (1234)" };
		const unchecked: UserEntry = { ...user, id: "unchecked", slackNamesSyncedAt: undefined };
		const { recipients } = selectTeamMemberRecipients(
			[teammate, wrongNames, unchecked],
			[
				{ slackId: "U_teammate", userId: "teammate-1" },
				{ slackId: "U_wrong", userId: "wrong" },
				{ slackId: "U_unchecked", userId: "unchecked" },
			],
			1234,
			null,
		);
		expect(Object.fromEntries(recipients.map(r => [r.slackUserId, r.withLink]))).toEqual({
			U_teammate: true,
			U_wrong: false,
			U_unchecked: false,
		});
	});
});

describe("nameFixMessage", () => {
	const names = { realName: "Jane Doe (1234)", displayName: "" };
	const check = checkSlackNames(names);

	it("explains the rules, what's wrong with these names, and what to change them to", () => {
		const text = nameFixMessage(names, check, "links_held");
		expect(text).toContain("gate links are on hold");
		expect(text).toContain("*Full name*: just your name");
		expect(text).toContain(
			"Full name has more than a name in it (team numbers or parentheses) (now `Jane Doe (1234)`)",
		);
		expect(text).toContain("Display name is empty");
		expect(text).toContain("• Full name: `Jane Doe`");
		expect(text).toContain("• Display name: `Jane Doe (1234)`");
		expect(text).toContain("Edit Profile");
		expect(text).toContain("within about 10 minutes");
	});

	it("frames an admin's nudge without promising links", () => {
		const text = nameFixMessage(names, check, "admin_nudge");
		expect(text).not.toContain("on hold");
		expect(text).toContain("any gate links you're entitled to");
	});

	it("leaves out suggestions it can't make, and keeps names from breaking the formatting", () => {
		const odd = { realName: "Jane `Doe`", displayName: "Jane" };
		const text = nameFixMessage(odd, checkSlackNames(odd), "admin_nudge");
		expect(text).toContain("(now `Jane`)");
		expect(text).not.toContain("Suggested:");
	});
});

describe("sendNameFixDm", () => {
	it("DMs the message", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
		const names = { realName: "Jane Doe", displayName: "Jane" };
		expect(await sendNameFixDm("U111", names, checkSlackNames(names), "admin_nudge")).toEqual({ sent: true });
		expect(bodyOf().channel).toBe("U111");
		expect(bodyOf().text).toContain("team number(s) in parentheses");
	});

	it("reports failures instead of throwing", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "user_not_found" })));
		const names = { realName: "Jane Doe", displayName: "Jane" };
		expect(await sendNameFixDm("U111", names, checkSlackNames(names), "admin_nudge")).toEqual({
			sent: false,
			reason: "slack_error",
			error: "user_not_found",
		});
		envState.SLACK_BOT_TOKEN = undefined;
		expect(await sendNameFixDm("U111", names, checkSlackNames(names), "admin_nudge")).toEqual({
			sent: false,
			reason: "slack_not_configured",
		});
	});
});
