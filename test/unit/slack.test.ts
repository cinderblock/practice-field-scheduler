import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SlackTypes from "~/server/slack";

const { envState } = vi.hoisted(() => ({
	envState: { SLACK_BOT_TOKEN: "xoxb-test-token" as string | undefined },
}));

vi.mock("~/env", () => ({
	env: envState,
}));

const {
	getSlackMember,
	isMissingScope,
	isSlackConfigured,
	listSlackMembers,
	sendDirectMessage,
	SlackApiError,
	SlackNotConfiguredError,
} = await import("~/server/slack");

const fetchMock = vi.fn();
beforeEach(() => {
	envState.SLACK_BOT_TOKEN = "xoxb-test-token";
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("isSlackConfigured", () => {
	it("returns true when SLACK_BOT_TOKEN is set", () => {
		expect(isSlackConfigured()).toBe(true);
	});

	it("returns false when SLACK_BOT_TOKEN is unset", () => {
		envState.SLACK_BOT_TOKEN = undefined;
		expect(isSlackConfigured()).toBe(false);
	});
});

describe("sendDirectMessage", () => {
	it("posts to chat.postMessage with bearer auth and JSON body", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, channel: "D123", ts: "1700000000.000100" }));
		const result = await sendDirectMessage({ slackUserId: "U999", text: "hi" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://slack.com/api/chat.postMessage");
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test-token");
		expect(JSON.parse(init.body as string)).toEqual({ channel: "U999", text: "hi" });
		expect(result).toEqual({ channel: "D123", ts: "1700000000.000100" });
	});

	it("falls back to the slack user ID for the channel when Slack omits it", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, ts: "1700000000.000200" }));
		const result = await sendDirectMessage({ slackUserId: "U999", text: "hi" });
		expect(result.channel).toBe("U999");
	});

	it("throws SlackNotConfiguredError when the token is unset", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		await expect(sendDirectMessage({ slackUserId: "U999", text: "hi" })).rejects.toBeInstanceOf(
			SlackNotConfiguredError,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("throws SlackApiError when Slack returns ok: false", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "channel_not_found" }));
		const err = await sendDirectMessage({ slackUserId: "U999", text: "hi" }).catch(e => e);
		expect(err).toBeInstanceOf(SlackApiError);
		expect((err as SlackTypes.SlackApiError).slackError).toBe("channel_not_found");
		expect((err as SlackTypes.SlackApiError).method).toBe("chat.postMessage");
	});

	it("throws SlackApiError when the response is not valid JSON", async () => {
		fetchMock.mockResolvedValue(new Response("not json", { status: 500 }));
		const err = await sendDirectMessage({ slackUserId: "U999", text: "hi" }).catch(e => e);
		expect(err).toBeInstanceOf(SlackApiError);
		expect((err as SlackTypes.SlackApiError).slackError).toBe("HTTP 500");
	});

	it("throws SlackApiError with 'timeout' when fetch is aborted", async () => {
		vi.useFakeTimers();
		try {
			// Fetch hangs forever until aborted, then rejects with AbortError (real fetch behavior).
			fetchMock.mockImplementation((_url, init) => {
				return new Promise((_resolve, reject) => {
					const signal = (init as RequestInit | undefined)?.signal;
					signal?.addEventListener("abort", () => {
						const err = new Error("aborted");
						err.name = "AbortError";
						reject(err);
					});
				});
			});
			const promise = sendDirectMessage({ slackUserId: "U999", text: "hi" }).catch(e => e);
			await vi.advanceTimersByTimeAsync(11_000);
			const err = await promise;
			expect(err).toBeInstanceOf(SlackApiError);
			expect((err as SlackTypes.SlackApiError).slackError).toContain("timeout");
		} finally {
			vi.useRealTimers();
		}
	});
});

function formBody(call: unknown[]): Record<string, string> {
	const init = call[1] as RequestInit;
	expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
	return Object.fromEntries(new URLSearchParams(init.body as string));
}

const person = (id: string, real_name: string, display_name: string, extra: Record<string, unknown> = {}) => ({
	id,
	profile: { real_name, display_name },
	...extra,
});

describe("getSlackMember", () => {
	it("reads both names with a form-encoded users.info call", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, user: person("U1", "Jane Doe", "Jane Doe (1234)") }));
		expect(await getSlackMember("U1")).toEqual({
			id: "U1",
			realName: "Jane Doe",
			displayName: "Jane Doe (1234)",
			deleted: false,
		});
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://slack.com/api/users.info");
		expect(formBody(fetchMock.mock.calls[0] as unknown[])).toEqual({ user: "U1" });
	});

	it("treats a missing display name as empty and reports deactivated accounts", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true, user: { id: "U1", deleted: true, profile: {} } }));
		expect(await getSlackMember("U1")).toEqual({ id: "U1", realName: "", displayName: "", deleted: true });
	});

	it("returns null for bots, app users, Slackbot and unknown IDs", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, user: person("B1", "Bot", "", { is_bot: true }) }));
		expect(await getSlackMember("B1")).toBeNull();
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, user: person("A1", "App", "", { is_app_user: true }) }));
		expect(await getSlackMember("A1")).toBeNull();
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, user: person("USLACKBOT", "Slackbot", "") }));
		expect(await getSlackMember("USLACKBOT")).toBeNull();
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "user_not_found" }));
		expect(await getSlackMember("U404")).toBeNull();
	});

	it("throws on a response without a user, and flags a missing scope", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
		await expect(getSlackMember("U1")).rejects.toBeInstanceOf(SlackApiError);

		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "missing_scope", needed: "users:read" }));
		const err = await getSlackMember("U1").catch(e => e);
		expect(isMissingScope(err)).toBe(true);
		expect(isMissingScope(new Error("missing_scope"))).toBe(false);
	});
});

describe("listSlackMembers", () => {
	it("follows cursors until the last page, keeping only people", async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse({
					ok: true,
					members: [person("U1", "Jane Doe", "Jane Doe (1234)"), person("B1", "Bot", "", { is_bot: true })],
					response_metadata: { next_cursor: "page2" },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					ok: true,
					members: [person("U2", "Old Mentor", "", { deleted: true })],
					response_metadata: { next_cursor: "" },
				}),
			);

		expect(await listSlackMembers()).toEqual([
			{ id: "U1", realName: "Jane Doe", displayName: "Jane Doe (1234)", deleted: false },
			{ id: "U2", realName: "Old Mentor", displayName: "", deleted: true },
		]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(formBody(fetchMock.mock.calls[0] as unknown[])).toEqual({ limit: "200" });
		expect(formBody(fetchMock.mock.calls[1] as unknown[])).toEqual({ limit: "200", cursor: "page2" });
	});

	it("never reads a response without members as an empty workspace", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
		await expect(listSlackMembers()).rejects.toBeInstanceOf(SlackApiError);
	});

	it("throws SlackNotConfiguredError without a token", async () => {
		envState.SLACK_BOT_TOKEN = undefined;
		await expect(listSlackMembers()).rejects.toBeInstanceOf(SlackNotConfiguredError);
	});
});
