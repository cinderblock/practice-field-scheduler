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
			displayName?: string; // Slack display_name
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
			profile(profile) {
				return {
					id: profile.sub,
					name: profile.name, // real_name from Slack
					email: profile.email,
					image: profile.picture,
					displayName: profile["https://slack.com/user_name"] as string | undefined, // display_name from Slack
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
		jwt: ({ token, profile }) => {
			if (profile) {
				token.displayName = profile.displayName;
			}
			return token;
		},
		session: ({ session, token }) => ({
			...session,
			user: {
				...session.user,
				id: token.sub,
				displayName: token.displayName as string | undefined,
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
