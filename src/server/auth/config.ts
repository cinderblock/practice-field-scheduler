import type { DefaultSession, NextAuthConfig } from "next-auth";
import SlackProvider from "next-auth/providers/slack";
import { env } from "../../env.js";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
	interface Session extends DefaultSession {
		user: {
			id: string;
			// ...other properties
			// role: UserRole;
		} & DefaultSession["user"];
	}

	// interface User {
	//   // ...other properties
	//   // role: UserRole;
	// }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
	providers: [
		SlackProvider({
			clientId: env.AUTH_SLACK_CLIENT_ID,
			clientSecret: env.AUTH_SLACK_CLIENT_SECRET,
			authorization: {
				params: {
					team: env.AUTH_SLACK_TEAM_ID,
				},
			},
			// Sign in with Slack (OpenID Connect) carries a single `name` claim and no
			// display name. The Slack names the scheduler checks come from the Web
			// API instead; see `syncSlackNames` in the backend.
			profile(profile) {
				return {
					id: profile.sub,
					name: profile.name,
					email: profile.email,
					image: profile.picture,
				};
			},
		}),
		/**
		 * ...add more providers here.
		 *
		 * Most other providers require a bit more work than the Discord provider. For example, the
		 * GitHub provider requires you to add the `refresh_token_expires_in` field to the Account
		 * model. Refer to the NextAuth.js docs for the provider you want to use. Example:
		 *
		 * @see https://next-auth.js.org/providers/github
		 */
	],
	callbacks: {
		/**
		 * Put the person's real Slack user id in the token at sign-in.
		 *
		 * Auth.js mints a random UUID for `user.id` on every OAuth sign-in,
		 * whatever `profile()` returned, and only keeps the provider's id as
		 * `account.providerAccountId`. Left alone, `token.sub` (and so
		 * `session.user.id`) is that UUID -- which is exactly what happened here
		 * for over a year: every sign-in looked like a brand-new "Slack id",
		 * `users.info` never found anyone, and gate links could never be sent.
		 *
		 * Slack's OpenID Connect id_token carries the user id under
		 * `https://slack.com/user_id` (and as `sub`); `providerAccountId` is the
		 * `sub` our `profile()` handed back. Only runs at sign-in (`account` is
		 * set then and only then); later requests keep the token as is.
		 *
		 * Sessions issued before this callback still carry a UUID until they
		 * expire; the backend repairs those by email. See `getUser` there.
		 */
		jwt: ({ token, account, profile }) => {
			if (!account) return token;
			const claim = (profile as Record<string, unknown> | undefined)?.["https://slack.com/user_id"];
			const slackId = typeof claim === "string" && claim ? claim : account.providerAccountId;
			if (slackId) token.sub = slackId;
			return token;
		},
		// Sign-in is never refused for how someone's Slack names look: names
		// only decide whether they receive gate links.
		session: ({ session, token }) => ({
			...session,
			user: {
				...session.user,
				id: token.sub,
			},
		}),
		redirect: async () => "/",
	},
	// debug: true,
	trustHost: true,
	session: {
		strategy: "jwt",
	},
	cookies: {
		sessionToken: {
			name: "next-auth.session-token",
			options: {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				secure: process.env.NODE_ENV === "production",
			},
		},
	},
	pages: {
		signIn: "/login",
	},
} satisfies NextAuthConfig;
