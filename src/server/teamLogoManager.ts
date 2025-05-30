// This file manages loading and caching logos from the FIRST API.

import FRC from "first-events-api";
import { env } from "~/env";
import fs from "node:fs/promises";
import path from "node:path";

const frc = FRC({
	username: env.FIRST_API_USERNAME,
	auth: env.FIRST_API_AUTH_TOKEN,
	season: new Date().getFullYear(),
});

// Cache directory for team avatars (year-specific)
const CURRENT_YEAR = new Date().getFullYear();
const CACHE_DIR = path.join(process.cwd(), "data", CURRENT_YEAR.toString(), "team-avatars");

// Ensure cache directory exists
async function ensureCacheDir() {
	try {
		await fs.access(CACHE_DIR);
	} catch {
		await fs.mkdir(CACHE_DIR, { recursive: true });
	}
}

/**
 * Gets the file path for a team avatar in the cache
 */
function getAvatarCachePath(team: number): string {
	return path.join(CACHE_DIR, `${team}.png`);
}

/**
 * Checks if a team avatar exists in the cache
 */
async function isAvatarCached(team: number): Promise<boolean> {
	try {
		await fs.access(getAvatarCachePath(team));
		return true;
	} catch {
		return false;
	}
}

/**
 * Saves a team avatar to the cache
 */
async function saveAvatarToCache(team: number, avatarBuffer: Buffer): Promise<void> {
	await ensureCacheDir();
	const cachePath = getAvatarCachePath(team);
	await fs.writeFile(cachePath, avatarBuffer);
}

/**
 * Loads a team avatar from the cache
 */
async function loadAvatarFromCache(team: number): Promise<Buffer> {
	const cachePath = getAvatarCachePath(team);
	return await fs.readFile(cachePath);
}

/**
 * Fetches the avatar for a team from the FIRST API.
 * @param team The team number to fetch the avatar for.
 * @returns The avatar for the team as a PNG file
 */
async function fetchAvatarFromAPI(team: number): Promise<Buffer> {
	const r = await frc.season.getTeamAvatarListings("", team);

	if (r.statusCode !== 200) {
		throw new Error(`Failed to get avatar for team ${team}`);
	}

	if (r.data.teamCountTotal > 1) {
		throw new Error(`Expected 1 avatar for team ${team}, got ${r.data.teamCountTotal}`);
	}

	const avatar = r.data.teams[0]?.encodedAvatar;

	if (!avatar) {
		throw new Error(`No avatar found for team ${team}`);
	}

	return Buffer.from(avatar, "base64");
}

/**
 * Gets a team avatar, checking cache first and falling back to API
 * @param team The team number to get the avatar for
 * @returns The avatar for the team as a PNG buffer
 */
export async function getTeamAvatar(team: number): Promise<Buffer> {
	// Check cache first
	if (await isAvatarCached(team)) {
		return await loadAvatarFromCache(team);
	}

	// Fetch from API and cache
	const avatarBuffer = await fetchAvatarFromAPI(team);
	await saveAvatarToCache(team, avatarBuffer);

	return avatarBuffer;
}
