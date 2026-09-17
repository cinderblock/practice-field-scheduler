import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackMember } from "~/server/slack";

const { envState, getSlackMember } = vi.hoisted(() => ({
	envState: {
		// Mirror the prod-shape so authConfig can construct SlackProvider without
		// blowing up at import time; tests only exercise the signIn callback.
		AUTH_SLACK_CLIENT_ID: "test-slack-client-id",
		AUTH_SLACK_CLIENT_SECRET: "AUTH_SLACK_CLIENT_SECRET12345678",
		AUTH_SLACK_TEAM_ID: "T12345",
		STRICT_SLACK_NAMES: false as boolean,
	},
	getSlackMember: vi.fn<(id: string) => Promise<SlackMember | null>>(),
}));

vi.mock("~/env", () => ({
	env: envState,
}));

vi.mock("~/server/slack", () => ({
	getSlackMember,
}));

const { authConfig } = await import("~/server/auth/config");

type SignInCb = NonNullable<NonNullable<typeof authConfig.callbacks>["signIn"]>;
const signIn = authConfig.callbacks?.signIn as SignInCb;

// Sign in with Slack's profile: `sub` is the Slack user ID, and there's no display name.
function args(sub: string | undefined): Parameters<SignInCb>[0] {
	return {
		user: { id: "u" },
		account: null,
		profile: sub === undefined ? undefined : { sub, name: "whatever Slack sends" },
	} as unknown as Parameters<SignInCb>[0];
}

function member(realName: string, displayName: string): SlackMember {
	return { id: "U1", realName, displayName, deleted: false };
}

beforeEach(() => {
	getSlackMember.mockReset();
});

describe("authConfig.callbacks.signIn", () => {
	it("lets everyone in when STRICT_SLACK_NAMES is off, without asking Slack", async () => {
		envState.STRICT_SLACK_NAMES = false;
		expect(await signIn(args("U1"))).toBe(true);
		expect(getSlackMember).not.toHaveBeenCalled();
	});

	it("checks both Slack names from the Web API when STRICT is on", async () => {
		envState.STRICT_SLACK_NAMES = true;
		getSlackMember.mockResolvedValue(member("Jane Doe", "Jane Doe (1234, 5678)"));
		expect(await signIn(args("U1"))).toBe(true);
		expect(getSlackMember).toHaveBeenCalledWith("U1");
	});

	it("sends people with wrong names to the fix-your-names page", async () => {
		envState.STRICT_SLACK_NAMES = true;
		getSlackMember.mockResolvedValue(member("Jane Doe (1234)", "Jane Doe (1234)"));
		expect(await signIn(args("U1"))).toBe("/login?error=BadSlackName");
		getSlackMember.mockResolvedValue(member("Jane Doe", ""));
		expect(await signIn(args("U1"))).toBe("/login?error=BadSlackName");
	});

	it("lets people in when their names can't be read, rather than locking everyone out", async () => {
		envState.STRICT_SLACK_NAMES = true;
		getSlackMember.mockRejectedValue(new Error("missing_scope"));
		expect(await signIn(args("U1"))).toBe(true);
		getSlackMember.mockResolvedValue(null);
		expect(await signIn(args("U1"))).toBe(true);
	});

	it("lets people in when the profile is absent (defensive — shouldn't happen via Slack)", async () => {
		envState.STRICT_SLACK_NAMES = true;
		expect(await signIn(args(undefined))).toBe(true);
		expect(getSlackMember).not.toHaveBeenCalled();
	});
});
