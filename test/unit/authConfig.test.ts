import { describe, expect, it, vi } from "vitest";

const { envState } = vi.hoisted(() => ({
	envState: {
		// Mirror the prod shape so authConfig can construct SlackProvider without
		// blowing up at import time; tests only exercise the callbacks.
		AUTH_SLACK_CLIENT_ID: "test-slack-client-id",
		AUTH_SLACK_CLIENT_SECRET: "AUTH_SLACK_CLIENT_SECRET12345678",
		AUTH_SLACK_TEAM_ID: "T12345",
	},
}));

vi.mock("~/env", () => ({
	env: envState,
}));

const { authConfig } = await import("~/server/auth/config");

type Callbacks = NonNullable<typeof authConfig.callbacks>;
type JwtCb = NonNullable<Callbacks["jwt"]>;
type SessionCb = NonNullable<Callbacks["session"]>;
const jwt = authConfig.callbacks?.jwt as JwtCb;
const session = authConfig.callbacks?.session as SessionCb;

/**
 * What Auth.js hands the jwt callback at sign-in: `user.id` is the random UUID
 * it minted, `account.providerAccountId` is the `sub` our profile() returned,
 * and `profile` is the id_token's claims. On later requests only `token` is
 * set; `account` and `profile` are null/undefined.
 */
function signInArgs(profile: Record<string, unknown>, providerAccountId = "U0SUB"): Parameters<JwtCb>[0] {
	return {
		token: { sub: "3f8e2b1a-0000-4000-8000-000000000000", name: "Jane" },
		user: { id: "3f8e2b1a-0000-4000-8000-000000000000" },
		account: { provider: "slack", type: "oidc", providerAccountId },
		profile,
		trigger: "signIn",
	} as unknown as Parameters<JwtCb>[0];
}

function laterArgs(sub: string): Parameters<JwtCb>[0] {
	return { token: { sub, name: "Jane" }, user: undefined, account: null } as unknown as Parameters<JwtCb>[0];
}

describe("authConfig.callbacks.jwt", () => {
	it("puts the Slack user id from the id_token claim in the token at sign-in", async () => {
		const token = await jwt(signInArgs({ sub: "U0SUB", "https://slack.com/user_id": "U0CLAIM" }));
		expect(token?.sub).toBe("U0CLAIM");
	});

	it("falls back to the provider account id when the claim is absent", async () => {
		const token = await jwt(signInArgs({ sub: "U0SUB", name: "Jane" }, "U0SUB"));
		expect(token?.sub).toBe("U0SUB");
	});

	it("never leaves Auth.js's random UUID in place at sign-in", async () => {
		const token = await jwt(signInArgs({ sub: "U0SUB" }, "U0SUB"));
		expect(token?.sub).not.toMatch(/^[0-9a-f]{8}-/);
	});

	it("leaves the token alone on later requests", async () => {
		const token = await jwt(laterArgs("U0CLAIM"));
		expect(token?.sub).toBe("U0CLAIM");
	});
});

describe("authConfig.callbacks.session", () => {
	it("exposes token.sub as session.user.id", async () => {
		const result = await session({
			session: { user: { name: "Jane", email: "jane@example.com" }, expires: "2099-01-01T00:00:00.000Z" },
			token: { sub: "U0CLAIM" },
		} as unknown as Parameters<SessionCb>[0]);
		expect((result as { user: { id: string } }).user.id).toBe("U0CLAIM");
	});
});

describe("sign-in is never refused for Slack names", () => {
	it("has no signIn callback at all -- names only gate receiving gate links", () => {
		expect((authConfig.callbacks as Record<string, unknown>).signIn).toBeUndefined();
	});
});
