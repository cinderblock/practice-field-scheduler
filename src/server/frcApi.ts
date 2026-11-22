/**
 * The one client for FIRST's FRC Events API (https://frc-api.firstinspires.org), shared by
 * everything that calls it (team avatars, upcoming events) so they share one rate limit too.
 */

import * as FirstEventsApi from "first-events-api";
import { env } from "~/env";

/** FIRST asks API users to be gentle; one request per second across the whole app */
const RateLimitMs = 1000;
const RequestTimeoutMs = 15 * 1000;

// Global state for HMR persistence
declare global {
	var __frcApiLastRequest: number | undefined;
}

globalThis.__frcApiLastRequest ||= 0;

export const frc = FirstEventsApi.default({
	username: env.FIRST_API_USERNAME,
	auth: env.FIRST_API_AUTH_TOKEN,
	season: new Date().getFullYear(),
});

// The library sets no timeout, and a hung request would stall every caller behind the rate limit.
// It exports its axios instance at runtime but leaves it out of its types.
const { axios } = FirstEventsApi as unknown as { axios?: { defaults: { timeout?: number } } };
if (axios) axios.defaults.timeout = RequestTimeoutMs;

/** Resolves when the caller may send its request: at most one per second, app-wide */
export async function rateLimit(): Promise<void> {
	while (true) {
		const wait = (globalThis.__frcApiLastRequest ?? 0) + RateLimitMs - Date.now();
		if (wait <= 0) break;
		await new Promise(resolve => setTimeout(resolve, wait));
	}

	globalThis.__frcApiLastRequest = Date.now();
}
