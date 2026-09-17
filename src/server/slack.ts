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

/**
 * Write methods take JSON bodies. Read methods such as `users.info` and
 * `users.list` only read form-encoded arguments.
 */
type Encoding = "json" | "form";

async function callSlack(
	method: string,
	body: Record<string, string | number | undefined>,
	encoding: Encoding = "json",
): Promise<SlackApiResponse> {
	const token = env.SLACK_BOT_TOKEN;
	if (!token) throw new SlackNotConfiguredError();

	// AbortController so a wedged Slack call doesn't pin the event loop. The
	// outer caller surfaces this as a SlackApiError with "timeout".
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SLACK_REQUEST_TIMEOUT_MS);

	const fields = Object.entries(body).filter((e): e is [string, string | number] => e[1] !== undefined);

	let res: Response;
	try {
		res = await fetch(`${SLACK_API_BASE}/${method}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": encoding === "json" ? "application/json; charset=utf-8" : "application/x-www-form-urlencoded",
			},
			body:
				encoding === "json"
					? JSON.stringify(Object.fromEntries(fields))
					: new URLSearchParams(fields.map(([k, v]) => [k, String(v)])).toString(),
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

/** A real person in the workspace, with the two names the scheduler checks. */
export type SlackMember = {
	id: string;
	/** `profile.real_name` ("Full name" in Slack's profile editor). */
	realName: string;
	/** `profile.display_name`; empty when the person hasn't set one. */
	displayName: string;
	/** Deactivated accounts are reported so their links can be held. */
	deleted: boolean;
};

type RawMember = {
	id?: string;
	deleted?: boolean;
	is_bot?: boolean;
	is_app_user?: boolean;
	profile?: { real_name?: string; display_name?: string };
};

/** Slackbot is a user record, but not a person. */
const SLACKBOT_ID = "USLACKBOT";

function toMember(raw: RawMember): SlackMember | null {
	if (!raw.id || raw.id === SLACKBOT_ID || raw.is_bot || raw.is_app_user) return null;
	return {
		id: raw.id,
		realName: raw.profile?.real_name ?? "",
		displayName: raw.profile?.display_name ?? "",
		deleted: Boolean(raw.deleted),
	};
}

/**
 * Read one person's names (`users.info`, bot scope `users:read`). Returns null
 * for bots and app users, and for IDs Slack doesn't know.
 */
export async function getSlackMember(slackUserId: string): Promise<SlackMember | null> {
	let json: SlackApiResponse;
	try {
		json = await callSlack("users.info", { user: slackUserId }, "form");
	} catch (err) {
		if (err instanceof SlackApiError && err.slackError === "user_not_found") return null;
		throw err;
	}
	const raw = json.user as RawMember | undefined;
	if (!raw) throw new SlackApiError("users.info", "response had no user", json);
	return toMember(raw);
}

/** Page size for `users.list`; Slack recommends no more than 200. */
const USERS_LIST_PAGE_SIZE = 200;

/**
 * Every person in the workspace, deactivated ones included (`users.list`,
 * bot scope `users:read`). Throws rather than returning a partial or empty
 * list, so a bad response can never read as "nobody".
 */
export async function listSlackMembers(): Promise<SlackMember[]> {
	const members: SlackMember[] = [];
	let cursor: string | undefined;
	do {
		const json = await callSlack("users.list", { limit: USERS_LIST_PAGE_SIZE, cursor }, "form");
		if (!Array.isArray(json.members)) throw new SlackApiError("users.list", "response had no members", json);
		for (const raw of json.members as RawMember[]) {
			const member = toMember(raw);
			if (member) members.push(member);
		}
		const next = (json.response_metadata as { next_cursor?: string } | undefined)?.next_cursor;
		cursor = next ? next : undefined;
	} while (cursor);
	return members;
}

/** Slack's answer when the bot token lacks a scope (here, `users:read`). */
export function isMissingScope(err: unknown): boolean {
	return err instanceof SlackApiError && err.slackError === "missing_scope";
}

/** True if Slack messaging is wired up; safe to check before attempting a send. */
export function isSlackConfigured(): boolean {
	return Boolean(env.SLACK_BOT_TOKEN);
}
