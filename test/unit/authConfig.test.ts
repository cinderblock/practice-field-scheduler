import { describe, expect, it, vi } from "vitest";

const { envState } = vi.hoisted(() => ({
	envState: {
		// Mirror the prod-shape so authConfig can construct SlackProvider without
		// blowing up at import time; tests only exercise the signIn callback.
		AUTH_SLACK_CLIENT_ID: "test-slack-client-id",
		AUTH_SLACK_CLIENT_SECRET: "AUTH_SLACK_CLIENT_SECRET12345678",
		AUTH_SLACK_TEAM_ID: "T12345",
		STRICT_SLACK_NAMES: false as boolean,
	},
}));

vi.mock("~/env", () => ({
	env: envState,
}));

const { authConfig } = await import("~/server/auth/config");

type SignInCb = NonNullable<NonNullable<typeof authConfig.callbacks>["signIn"]>;
const signIn = authConfig.callbacks?.signIn as SignInCb;

function makeArgs(displayName: string | undefined, realName: string | undefined): Parameters<SignInCb>[0] {
	return {
		user: { id: "u" },
		account: null,
		// Slack's profile has the display name under a URI-shaped claim
		profile: {
			"https://slack.com/user_name": displayName,
			name: realName,
		},
	} as unknown as Parameters<SignInCb>[0];
}

describe("authConfig.callbacks.signIn", () => {
	it("returns true when STRICT_SLACK_NAMES is off, regardless of name format", () => {
		envState.STRICT_SLACK_NAMES = false;
		expect(signIn(makeArgs("Jane Doe (1234)", "Jane Doe"))).toBe(true);
		expect(signIn(makeArgs("just a name", "Jane Doe"))).toBe(true);
		expect(signIn(makeArgs(undefined, undefined))).toBe(true);
	});

	it("returns true when name is valid even with STRICT on", () => {
		envState.STRICT_SLACK_NAMES = true;
		expect(signIn(makeArgs("Jane Doe (1234)", "Jane Doe"))).toBe(true);
		expect(signIn(makeArgs("Jane Doe (1234, 5678)", "Jane Doe"))).toBe(true);
	});

	it("falls back to real name when display name is missing", () => {
		envState.STRICT_SLACK_NAMES = true;
		expect(signIn(makeArgs(undefined, "Jane Doe (1234)"))).toBe(true);
	});

	it("rejects to /login?error=BadSlackName when STRICT on and name doesn't parse", () => {
		envState.STRICT_SLACK_NAMES = true;
		expect(signIn(makeArgs("Jane Doe", "Jane Doe"))).toBe("/login?error=BadSlackName");
		expect(signIn(makeArgs("", ""))).toBe("/login?error=BadSlackName");
	});

	it("returns true when profile is absent (defensive — shouldn't happen via Slack)", () => {
		envState.STRICT_SLACK_NAMES = true;
		const args = { user: { id: "u" }, account: null } as unknown as Parameters<SignInCb>[0];
		expect(signIn(args)).toBe(true);
	});
});
