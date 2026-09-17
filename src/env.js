import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const _prod = process.env.NODE_ENV === "production";

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		NEXTAUTH_URL: z.string().url().startsWith("https://"),
		AUTH_SECRET: z.string(),
		AUTH_SLACK_CLIENT_ID: z.string().min(10),
		AUTH_SLACK_CLIENT_SECRET: z.string().length(32),

		AUTH_SLACK_TEAM_ID: z
			.string()
			.min(5)
			.refine(val => val.toUpperCase() === val, "Team ID must be uppercase")
			.refine(val => val.startsWith("T"), "Team ID must start with T")
			.optional(),
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		FIRST_API_USERNAME: z.string().min(1),
		FIRST_API_AUTH_TOKEN: z.string().length(36),
		DATA_DIR: z.string().min(1),
		STAGING: z.string().min(6).optional(),
		SCHEDULER_API_KEY: z.string().min(32).optional(),
		SLACK_BOT_TOKEN: z.string().startsWith("xoxb-", "Slack bot tokens start with 'xoxb-'").optional(),
		GATE_BASE_URL: z.string().url().optional(),
		// When truthy ("true"/"1"), reject Slack logins whose display name doesn't match
		// the "First Last (1234)" format. Leave unset for a soft rollout where the nudge DM
		// can run for a while before login starts denying. Unrecognized values fail loudly
		// so a typo like STRICT_SLACK_NAMES="yes" doesn't silently mean "off".
		STRICT_SLACK_NAMES: z
			.enum(["true", "false", "1", "0", ""])
			.optional()
			.transform(val => val === "true" || val === "1"),

		// Weather is optional; it is enabled by setting a location.
		// Either "latitude,longitude" (exact) or a place name / postal code to look up.
		WEATHER_LOCATION: z.string().trim().min(2).optional(),
		// Only needed for Open-Meteo's commercial tier
		WEATHER_API_KEY: z.string().min(1).optional(),
		WEATHER_UPDATES_PER_DAY: z.coerce
			.number()
			.int()
			.min(1, "Weather must update at least once per day")
			.max(24 * 60, "Weather can update at most once per minute")
			.default(24 * 4),
		WEATHER_FORECAST_DAYS: z.coerce
			.number()
			.int()
			.min(1, "Weather forecast must cover at least one day")
			.max(16, "Open-Meteo forecasts at most 16 days")
			.default(10),

		// Settings the browser needs too. They are read here, on the server, and handed to
		// client components by the provider in the root layout — NOT with a NEXT_PUBLIC_
		// prefix, which Next.js would bake into the bundle at build time. The image is built
		// once by CI and must work for any deployment; see the README's Deployment section.
		RESERVATION_DAYS: z
			.string()
			.transform(val => Number.parseInt(val, 10))
			.refine(num => num > 0, "Reservation days must be a positive number"),
		TIME_SLOT_BORDERS: z
			.string()
			.transform(val => val.split(/[^\d.-]/)) // Split by non-numeric characters
			.transform(numbers => numbers.filter(Boolean)) // Filter out empty strings
			.transform(numbers => numbers.map(v => Number.parseFloat(v)))
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
		TIME_ZONE: z.string().refine(isValidTimeZone, "Invalid timezone"),
		SITE_TITLE: z
			.string()
			.transform(val => val.trim())
			.refine(val => val.length > 0, "Site title cannot be empty"),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) so we need to destruct manually.
	 */
	runtimeEnv: {
		AUTH_SECRET: process.env.AUTH_SECRET,
		AUTH_SLACK_CLIENT_ID: process.env.AUTH_SLACK_CLIENT_ID,
		AUTH_SLACK_CLIENT_SECRET: process.env.AUTH_SLACK_CLIENT_SECRET,
		AUTH_SLACK_TEAM_ID: process.env.AUTH_SLACK_TEAM_ID,
		NEXTAUTH_URL: process.env.NEXTAUTH_URL,
		NODE_ENV: process.env.NODE_ENV,
		FIRST_API_USERNAME: process.env.FIRST_API_USERNAME,
		FIRST_API_AUTH_TOKEN: process.env.FIRST_API_AUTH_TOKEN,
		TIME_SLOT_BORDERS: process.env.TIME_SLOT_BORDERS,
		RESERVATION_DAYS: process.env.RESERVATION_DAYS,
		TIME_ZONE: process.env.TIME_ZONE,
		SITE_TITLE: process.env.SITE_TITLE,
		DATA_DIR: process.env.DATA_DIR,
		STAGING: process.env.STAGING,
		SCHEDULER_API_KEY: process.env.SCHEDULER_API_KEY,
		SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
		GATE_BASE_URL: process.env.GATE_BASE_URL,
		STRICT_SLACK_NAMES: process.env.STRICT_SLACK_NAMES,
		WEATHER_LOCATION: process.env.WEATHER_LOCATION,
		WEATHER_API_KEY: process.env.WEATHER_API_KEY,
		WEATHER_UPDATES_PER_DAY: process.env.WEATHER_UPDATES_PER_DAY,
		WEATHER_FORECAST_DAYS: process.env.WEATHER_FORECAST_DAYS,
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
	} catch (_e) {
		return false;
	}
	return true;
}
