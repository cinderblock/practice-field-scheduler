import type { DefaultSession, NextAuthConfig } from "next-auth";
import SlackProvider from "next-auth/providers/slack";
import { env } from "../../env.js";
import { getSlackMember } from "../slack";
import { checkSlackNames } from "../util/slackName";

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
		 * With STRICT_SLACK_NAMES on, refuse sign-in until the person's Slack names
		 * follow the rules, read from Slack's Web API. If the names can't be read
		 * (no bot token, no `users:read`, Slack down), sign-in is allowed: gate
		 * links are held separately, and an outage shouldn't lock everyone out.
		 */
		signIn: async ({ profile }) => {
			if (!env.STRICT_SLACK_NAMES) return true;
			const slackId = profile?.sub;
			if (!slackId) return true;

			let member: Awaited<ReturnType<typeof getSlackMember>>;
			try {
				member = await getSlackMember(slackId);
			} catch (err) {
				console.warn(`STRICT_SLACK_NAMES: couldn't read Slack names for ${slackId}; allowing sign-in:`, err);
				return true;
			}
			if (!member) return true;
			if (checkSlackNames(member).ok) return true;
			// Redirect to the login page with a custom error so we can render
			// fix-your-names instructions instead of a generic auth failure.
			return "/login?error=BadSlackName";
		},
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
