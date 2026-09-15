import { env } from "~/env";

/**
 * Minimal Slack Web API client. We only need a couple of methods so this
 * stays a thin `fetch` wrapper rather than pulling in `@slack/web-api`.
 */

const SLACK_API_BASE = "https://slack.com/api";

/** How long any single Slack API call is allowed to take before we abort. */
export const SLACK_REQUEST_TIMEOUT_MS = 10_000;

export class SlackNotConfiguredError extends Error {
	constructor() {
		super("SLACK_BOT_TOKEN is not set");
		this.name = "SlackNotConfiguredError";
	}
}

export class SlackApiError extends Error {
	constructor(
		public readonly method: string,
		public readonly slackError: string,
		public readonly response?: unknown,
	) {
		super(`Slack API ${method} failed: ${slackError}`);
		this.name = "SlackApiError";
	}
}

type SlackApiResponse = {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
};

async function callSlack(method: string, body: Record<string, unknown>): Promise<SlackApiResponse> {
	const token = env.SLACK_BOT_TOKEN;
	if (!token) throw new SlackNotConfiguredError();

	// AbortController so a wedged Slack call doesn't pin the event loop. The
	// outer caller surfaces this as a SlackApiError with "timeout".
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SLACK_REQUEST_TIMEOUT_MS);

	let res: Response;
	try {
		res = await fetch(`${SLACK_API_BASE}/${method}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json; charset=utf-8",
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch (err) {
		if ((err as Error).name === "AbortError") {
			throw new SlackApiError(method, `timeout after ${SLACK_REQUEST_TIMEOUT_MS}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}

	const json = (await res.json().catch(() => ({}))) as SlackApiResponse;

	if (!json.ok) {
		throw new SlackApiError(method, json.error ?? `HTTP ${res.status}`, json);
	}

	return json;
}

export type SendDirectMessageArgs = {
	/** Slack user ID (e.g. "U01ABCDEF"); chat.postMessage treats this as a DM channel. */
	slackUserId: string;
	/** Plain text message body. */
	text: string;
};

export type SendDirectMessageResult = {
	/** The channel (DM) the message was posted to. */
	channel: string;
	/** Slack-assigned message timestamp / ID. */
	ts: string;
};

/**
 * DM a single Slack user as the bot. Posting to the user ID is equivalent
 * to posting to their bot-DM channel — Slack opens the conversation on
 * first send. Throws SlackNotConfiguredError if the bot token isn't set
 * and SlackApiError if Slack rejects the request.
 */
export async function sendDirectMessage({
	slackUserId,
	text,
}: SendDirectMessageArgs): Promise<SendDirectMessageResult> {
	const json = await callSlack("chat.postMessage", { channel: slackUserId, text });
	return {
		channel: String(json.channel ?? slackUserId),
		ts: String(json.ts ?? ""),
	};
}

/** True if Slack messaging is wired up; safe to check before attempting a send. */
export function isSlackConfigured(): boolean {
	return Boolean(env.SLACK_BOT_TOKEN);
}
