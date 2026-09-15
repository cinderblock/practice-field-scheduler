import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SlackTypes from "~/server/slack";

const { envState } = vi.hoisted(() => ({
	envState: { SLACK_BOT_TOKEN: "xoxb-test-token" as string | undefined },
}));

vi.mock("~/env", () => ({
	env: envState,
}));

const { isSlackConfigured, sendDirectMessage, SlackApiError, SlackNotConfiguredError } = await import("~/server/slack");

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
