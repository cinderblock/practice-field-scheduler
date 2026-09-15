import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserEntry } from "~/types";

const { envState } = vi.hoisted(() => ({
	envState: {
		GATE_BASE_URL: "https://gate.example.test" as string | undefined,
		SLACK_BOT_TOKEN: "xoxb-test-token" as string | undefined,
	},
}));

vi.mock("~/env", () => ({
	env: envState,
}));

const { gateAccessUrl, notifyTeamOfReservation, selectReservationDmRecipients, sendAccessTokenWelcome } = await import(
	"~/server/notifications"
);

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
	accessToken: "tok-jane-1234",
};

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

describe("sendAccessTokenWelcome", () => {
	it("sends the DM with the user's gate link", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, channel: "D1", ts: "0" })));
		const result = await sendAccessTokenWelcome(user, "U999");
		expect(result).toEqual({ sent: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body.channel).toBe("U999");
		expect(body.text).toContain("https://gate.example.test/g/tok-jane-1234");
		expect(body.text).toContain("Jane Doe (1234)");
	});

	it("falls back to a placeholder when the gate URL isn't configured", async () => {
		envState.GATE_BASE_URL = undefined;
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
		const result = await sendAccessTokenWelcome(user, "U999");
		expect(result).toEqual({ sent: true });
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(init.body as string);
		expect(body.text).toContain("(gate URL not configured");
		expect(body.text).not.toContain("https://");
	});

	it("returns slack_not_configured when SLACK_BOT_TOKEN is unset", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		const result = await sendAccessTokenWelcome(user, "U999");
		expect(result).toEqual({ sent: false, reason: "slack_not_configured" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns no_slack_id when the slack ID is missing", async () => {
		const result = await sendAccessTokenWelcome(user, null);
		expect(result).toEqual({ sent: false, reason: "no_slack_id" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns slack_error when chat.postMessage fails", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "user_not_found" })));
		const result = await sendAccessTokenWelcome(user, "U999");
		expect(result).toEqual({ sent: false, reason: "slack_error", error: "user_not_found" });
	});
});

describe("notifyTeamOfReservation", () => {
	const reservation = {
		id: "res-1",
		date: "2026-05-23",
		slot: "10:00am",
		created: new Date("2026-05-20T00:00:00Z"),
		userId: "user-creator",
		priority: false,
		team: 1234,
		notes: "Bring batteries",
	};

	const otherTeammate: UserEntry = {
		...user,
		id: "user-2",
		name: "Alex Doe",
		displayName: "Alex Doe (1234)",
		accessToken: "tok-alex",
	};

	it("DMs every recipient and includes their personal gate link", async () => {
		fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, channel: "D1", ts: "0" })));
		const outcomes = await notifyTeamOfReservation(reservation, [
			{ user, slackUserId: "U111" },
			{ user: otherTeammate, slackUserId: "U222" },
		]);
		expect(outcomes).toHaveLength(2);
		expect(outcomes.every(o => o.sent)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
		expect(bodies[0].channel).toBe("U111");
		expect(bodies[0].text).toContain("Team 1234");
		expect(bodies[0].text).toContain("https://gate.example.test/g/tok-jane-1234");
		expect(bodies[0].text).toContain("Bring batteries");
		expect(bodies[1].channel).toBe("U222");
		expect(bodies[1].text).toContain("https://gate.example.test/g/tok-alex");
	});

	it("returns no-DM outcomes when slack is not configured (doesn't call fetch)", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		const outcomes = await notifyTeamOfReservation(reservation, [{ user, slackUserId: "U111" }]);
		expect(outcomes).toEqual([{ userId: "user-1", slackUserId: "U111", sent: false, reason: "slack_not_configured" }]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns [] when there are no recipients (doesn't probe slack config)", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		const outcomes = await notifyTeamOfReservation(reservation, []);
		expect(outcomes).toEqual([]);
	});

	it("reports per-recipient failures without aborting the batch", async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "user_not_found" })));
		const outcomes = await notifyTeamOfReservation(reservation, [
			{ user, slackUserId: "U111" },
			{ user: otherTeammate, slackUserId: "U222" },
		]);
		expect(outcomes[0]?.sent).toBe(true);
		expect(outcomes[1]).toMatchObject({ sent: false, reason: "slack_error", error: "user_not_found" });
	});
});

describe("selectReservationDmRecipients", () => {
	const reservation = {
		id: "res-1",
		date: "2026-05-23",
		slot: "10:00am",
		created: new Date("2026-05-20T00:00:00Z"),
		userId: "creator",
		priority: false,
		team: 1234,
	};

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

	it("includes team members with a slack mapping, excluding the creator", () => {
		const { recipients, skipReason } = selectReservationDmRecipients(allUsers, mappings, reservation, "creator");
		expect(skipReason).toBeUndefined();
		const ids = recipients.map(r => r.slackUserId).sort();
		expect(ids).toEqual(["U_multi_a", "U_multi_b", "U_teammate"]);
	});

	it("excludes users on a different team", () => {
		const { recipients } = selectReservationDmRecipients(allUsers, mappings, reservation, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("other-team");
	});

	it("excludes admin users", () => {
		const { recipients } = selectReservationDmRecipients(allUsers, mappings, reservation, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("admin");
	});

	it("excludes disabled users", () => {
		const { recipients } = selectReservationDmRecipients(allUsers, mappings, reservation, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("disabled");
	});

	it("skips users with no Slack mapping silently", () => {
		const { recipients } = selectReservationDmRecipients(allUsers, mappings, reservation, "creator");
		expect(recipients.map(r => r.user.id)).not.toContain("no-slack");
	});

	it("creates one recipient per (user, slackId) pair when a user has multiple mappings", () => {
		const { recipients } = selectReservationDmRecipients(allUsers, mappings, reservation, "creator");
		const multi = recipients
			.filter(r => r.user.id === "multi-slack")
			.map(r => r.slackUserId)
			.sort();
		expect(multi).toEqual(["U_multi_a", "U_multi_b"]);
	});

	it("returns skipReason when the reservation team isn't a number", () => {
		const stringTeamRes = { ...reservation, team: "not-a-number" };
		const { recipients, skipReason } = selectReservationDmRecipients(allUsers, mappings, stringTeamRes, "creator");
		expect(skipReason).toBe("non_numeric_team");
		expect(recipients).toEqual([]);
	});

	it("coerces a numeric-string team to its number", () => {
		const stringTeamRes = { ...reservation, team: "1234" };
		const { recipients } = selectReservationDmRecipients(allUsers, mappings, stringTeamRes, "creator");
		expect(recipients.length).toBeGreaterThan(0);
		expect(recipients.every(r => r.user.teams !== "admin" && (r.user.teams as number[]).includes(1234))).toBe(true);
	});
});
