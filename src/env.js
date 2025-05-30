console.log("Loading env.js");
console.log(process.pid);

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		AUTH_SECRET: process.env.NODE_ENV === "production" ? z.string() : z.string().optional(),
		AUTH_SLACK_CLIENT_ID: z.string().min(10),
		AUTH_SLACK_CLIENT_SECRET: z.string().length(32),
		AUTH_SLACK_SIGNING_SECRET: z.string().length(32).optional(),
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		FIRST_API_USERNAME: z.string().min(1),
		FIRST_API_AUTH_TOKEN: z.string().length(36),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		// NEXT_PUBLIC_CLIENTVAR: z.string(),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		AUTH_SECRET: process.env.AUTH_SECRET,
		AUTH_SLACK_CLIENT_ID: process.env.AUTH_SLACK_CLIENT_ID,
		AUTH_SLACK_CLIENT_SECRET: process.env.AUTH_SLACK_CLIENT_SECRET,
		AUTH_SLACK_SIGNING_SECRET: process.env.AUTH_SLACK_SIGNING_SECRET,
		NODE_ENV: process.env.NODE_ENV,
		FIRST_API_USERNAME: process.env.FIRST_API_USERNAME,
		FIRST_API_AUTH_TOKEN: process.env.FIRST_API_AUTH_TOKEN,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
