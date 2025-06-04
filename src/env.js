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
		NEXT_PUBLIC_RESERVATION_DAYS: z
			.string()
			.transform(val => Number.parseInt(val, 10))
			.refine(num => num > 0, "Reservation days must be a positive number"),
		NEXT_PUBLIC_TIME_SLOT_BORDERS: z
			.string()
			.transform(val => val.split(/[^\d.-]/)) // Split by non-numeric characters
			.transform(numbers => numbers.filter(Boolean)) // Filter out empty strings
			.transform(numbers => numbers.map(v => Number.parseInt(v, 10))) // Parse as base 10 integers
			.refine(numbers => numbers.length, "Time slot borders must be a comma-separated list of numbers")
			.refine(numbers => numbers.length >= 2, "Time slots need at least two numbers to define a range")
			.refine(numbers => numbers.every(n => !Number.isNaN(n)), "Time slot borders must be numbers")
			.refine(numbers => numbers.every(n => n >= -12 && n <= 12), "Time slot borders must be between -12 and 12")
			.refine(numbers => numbers.every((n, i) => numbers.indexOf(n) === i), "Time slot borders must be unique")
			.refine(
				// @ts-ignore
				numbers => numbers.every((n, i, a) => !i || n > a[i - 1]),
				"Time slot borders must be in ascending order",
			),
		NEXT_PUBLIC_TIME_ZONE: z.string().refine(isValidTimeZone, "Invalid timezone"),
		NEXT_PUBLIC_SITE_TITLE: z
			.string()
			.transform(val => val.trim())
			.refine(val => val.length > 0, "Site title cannot be empty"),
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
		NEXT_PUBLIC_TIME_SLOT_BORDERS: process.env.NEXT_PUBLIC_TIME_SLOT_BORDERS,
		NEXT_PUBLIC_RESERVATION_DAYS: process.env.NEXT_PUBLIC_RESERVATION_DAYS,
		NEXT_PUBLIC_TIME_ZONE: process.env.NEXT_PUBLIC_TIME_ZONE,
		NEXT_PUBLIC_SITE_TITLE: process.env.NEXT_PUBLIC_SITE_TITLE,
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

/**
 * @param {string} timeZone
 */
function isValidTimeZone(timeZone) {
	try {
		Intl.DateTimeFormat(undefined, { timeZone });
	} catch (e) {
		return false;
	}
	return true;
}
