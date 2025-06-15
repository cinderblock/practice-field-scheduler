// This file manages loading and caching logos from the FIRST API.

import FRC from "first-events-api";
import { env } from "~/env";

const CURRENT_YEAR = new Date().getFullYear();

// Global state for HMR persistence
declare global {
	var __avatarCache: Map<number, { avatar: Buffer | undefined; timestamp: number }> | undefined;
	var __lastRequestTime: number | undefined;
}

// Initialize global state
globalThis.__avatarCache ||= new Map();
globalThis.__lastRequestTime ||= 0;

const avatarCache = globalThis.__avatarCache;
let lastRequestTime = globalThis.__lastRequestTime;

const frc = FRC({
	username: env.FIRST_API_USERNAME,
	auth: env.FIRST_API_AUTH_TOKEN,
	season: CURRENT_YEAR,
});

// Rate limiting: 1 request per second
const RATE_LIMIT_MS = 1000;
// Cache non-existent logos for 1 hour
const NON_EXISTENT_CACHE_MS = 60 * 60 * 1000;
// Refresh known avatars daily
const AVATAR_REFRESH_MS = 24 * 60 * 60 * 1000;

// Track in-flight requests to prevent duplicate API calls
const inFlightRequests = new Map<number, Promise<Buffer | undefined>>();

/**
 * Rate limits API requests to 1 per second
 */
async function rateLimit(): Promise<void> {
	while (true) {
		const timeSinceLastRequest = Date.now() - lastRequestTime;

		if (timeSinceLastRequest < RATE_LIMIT_MS) {
			await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastRequest));
		} else break;
	}

	lastRequestTime = Date.now();
}

/**
 * Fetches the avatar for a team from the FIRST API.
 * @param team The team number to fetch the avatar for.
 * @returns The avatar for the team as a PNG file
 */
async function fetchAvatarFromAPI(team: number): Promise<Buffer | undefined> {
	await rateLimit();

	const r = await frc.season.getTeamAvatarListings("", team).catch(() => undefined);

	if (r?.statusCode !== 200) return undefined;

	if (r.data.teamCountTotal > 1) {
		// Something is very wrong if this happens
		console.log(new Error(`Expected 1 avatar for team ${team}, got ${r.data.teamCountTotal}`));
		return undefined;
	}

	const avatar = r.data.teams[0]?.encodedAvatar;

	if (!avatar) return undefined;

	return Buffer.from(avatar, "base64");
}

/**
 * Gets a team avatar, checking cache first and falling back to API
 * @param team The team number to get the avatar for
 * @returns The avatar for the team as a PNG buffer
 */
export async function getTeamAvatar(team: number): Promise<Buffer | undefined> {
	// Check if we already have an in-flight request
	const inFlight = inFlightRequests.get(team);
	if (inFlight) return inFlight;

	const cached = avatarCache.get(team);

	if (cached) {
		const delta = Date.now() - cached.timestamp;
		// If it's a non-existent logo, check if the cache has expired
		if (cached.avatar === null) {
			if (delta < NON_EXISTENT_CACHE_MS) return undefined;
		}
		// If it's a known avatar, check if it needs refreshing
		else if (delta <= AVATAR_REFRESH_MS) return cached.avatar;
	}

	// Create a new request
	const avatarBuffer = fetchAvatarFromAPI(team);
	avatarBuffer.then(avatar => {
		avatarCache.set(team, { avatar, timestamp: Date.now() });
		inFlightRequests.delete(team);
	});

	inFlightRequests.set(team, avatarBuffer);

	// Optimistically return the cached avatar if it exists
	return cached?.avatar ?? avatarBuffer;
}
