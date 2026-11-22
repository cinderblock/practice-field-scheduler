/**
 * Our teams' FRC events, from FIRST's FRC Events API.
 *
 * "Our teams" are the team numbers on the site's user accounts. For this season and the next, the
 * server asks FIRST for every event (only to learn each competition week's dates) and then for each
 * team's events, one request per second. The result is cached in memory and refreshed in the
 * background, so page loads never wait on FIRST except briefly for the very first fetch.
 *
 * Shown on the calendar (a break before each weekend our teams compete) and on /events. The same
 * snapshot is what team prioritization (#8) reads, through `getFrcEvents` and `eventsByTeam`.
 */

import type { EventDate, FrcEvent, FrcEventsSnapshot, FrcSeasonWeek, Team } from "~/types";
import { frc, rateLimit as frcRateLimit } from "./frcApi";
import {
	compareEvents,
	eventsByTeam,
	type FrcEventInfo,
	mergeRegistrations,
	parseEventListing,
	seasonWeeks,
} from "./util/frcEvents";

/** Registrations change slowly, and a full refresh is a couple of requests per team */
const RefreshIntervalMs = 6 * 60 * 60 * 1000;
/** How long a page load will wait for the first snapshot after startup */
const FirstFetchWaitMs = 3 * 1000;
/** A snapshot this old is withheld rather than shown, if refreshing keeps failing */
const MaxSnapshotAgeMs = 3 * 24 * 60 * 60 * 1000;

/** Fetches the body of FIRST's event listing for a season, optionally only one team's events */
export type EventLister = (season: number, team?: Team) => Promise<unknown>;

const listEvents: EventLister = async (season, team) => {
	const response = await frc.season.getEventListings(
		undefined,
		team,
		undefined,
		undefined,
		undefined,
		undefined,
		season,
	);
	// The library throws on error statuses itself; this just narrows the type
	if (response.statusCode !== 200) throw new Error(`FIRST answered ${response.statusCode}`);
	return response.data;
};

/** The HTTP status FIRST answered with, if it answered at all (axios errors carry the response) */
function httpStatus(err: unknown): number | undefined {
	if (typeof err !== "object" || err === null || !("response" in err)) return undefined;
	const { response } = err as { response?: { status?: unknown } };
	return typeof response?.status === "number" ? response.status : undefined;
}

/**
 * FIRST answered that what was asked for doesn't exist: a season it hasn't published, or a team it
 * doesn't know that season. Anything else (unreachable, bad credentials, rate limited, a server
 * error) is a failure, and must not be mistaken for "no events", or it would wipe the cache.
 */
function isNotFound(err: unknown) {
	const status = httpStatus(err);
	// 501 is FIRST's "Request Did Not Match Any Current API Pattern", which is what an unknown season gets
	return status === 400 || status === 404 || status === 501;
}

function describeError(err: unknown) {
	const status = httpStatus(err);
	const message = err instanceof Error ? err.message : String(err);
	return status ? `HTTP ${status}` : message;
}

export type FetchOptions = {
	teams: readonly Team[];
	seasons: readonly number[];
	/** The last snapshot, for anything this fetch can't get */
	previous?: FrcEventsSnapshot;
	/** Injectable for tests */
	listEvents?: EventLister;
	rateLimit?: () => Promise<void>;
	now?: () => Date;
};

export type FetchResult = {
	snapshot: FrcEventsSnapshot;
	/** What went wrong without spoiling the whole fetch, for the log */
	problems: string[];
};

/**
 * Fetch our teams' events for some seasons.
 *
 * A season FIRST hasn't published yet (no events, or "not found") is skipped. A season or team
 * whose request fails keeps its data from `previous`. Throws if no season could be fetched at all
 * (FIRST unreachable, or the credentials refused), so the caller keeps its previous snapshot.
 */
export async function fetchEventsSnapshot({
	teams,
	seasons,
	previous,
	listEvents: list = listEvents,
	rateLimit = frcRateLimit,
	now = () => new Date(),
}: FetchOptions): Promise<FetchResult> {
	const problems: string[] = [];
	const published: number[] = [];
	const weeks: FrcSeasonWeek[] = [];
	const events: FrcEvent[] = [];
	let reached = false;
	let lastError: unknown;

	const previousFor = (season: number) => ({
		weeks: previous?.weeks.filter(week => week.season === season) ?? [],
		events: previous?.events.filter(event => event.season === season) ?? [],
	});

	for (const season of seasons) {
		let all: FrcEventInfo[];
		try {
			await rateLimit();
			all = parseEventListing(await list(season), season);
			reached = true;
		} catch (err) {
			if (isNotFound(err)) {
				// FIRST answered, so it's reachable; this season just isn't there (yet)
				reached = true;
				continue;
			}
			lastError = err;
			const kept = previousFor(season);
			if (previous?.seasons.includes(season)) {
				published.push(season);
				weeks.push(...kept.weeks);
				events.push(...kept.events);
			}
			problems.push(`${season} events: ${describeError(err)}`);
			continue;
		}

		// FIRST lists a season before scheduling anything in it
		if (!all.length) continue;

		published.push(season);
		weeks.push(...seasonWeeks(season, all));

		const perTeam: [Team, FrcEventInfo[]][] = [];
		for (const team of teams) {
			try {
				await rateLimit();
				perTeam.push([team, parseEventListing(await list(season, team), season)]);
			} catch (err) {
				// FIRST doesn't know this team this season: no events
				if (isNotFound(err)) continue;
				problems.push(`${season} events for team ${team}: ${describeError(err)}`);
				const kept = previousFor(season).events.filter(event => event.teams.includes(team));
				perTeam.push([team, kept.map(({ teams: _, ...info }) => info)]);
			}
		}

		events.push(...mergeRegistrations(perTeam));
	}

	if (!reached && seasons.length) throw lastError ?? new Error("No seasons fetched");

	return {
		snapshot: {
			updated: now(),
			seasons: published.sort((a, b) => a - b),
			weeks,
			events: events.sort(compareEvents),
		},
		problems,
	};
}

/** This season, and the next once it's being scheduled (FIRST publishes it in the fall) */
export function seasonsToFetch(today: Date): number[] {
	const year = today.getFullYear();
	return [year, year + 1];
}

////// Background refresh and cache //////

type FrcEventsState = {
	snapshot?: FrcEventsSnapshot;
	refreshing?: Promise<void>;
	timer?: ReturnType<typeof setInterval>;
	/** Set while refreshes are failing, so a long outage logs once rather than every interval */
	failing?: boolean;
};

// Global storage for HMR persistence
declare global {
	var __frcEvents: FrcEventsState | undefined;
}

globalThis.__frcEvents ||= {};
const state = globalThis.__frcEvents;

// A reloaded module (dev HMR) must not leave the previous module's timer running its stale code
if (state.timer) {
	clearInterval(state.timer);
	state.timer = undefined;
}

async function updateSnapshot() {
	// Imported here so this module (and its tests) don't load the whole backend just to be imported
	const { knownTeamNumbers } = await import("./backend");
	const teams = await knownTeamNumbers();

	const { snapshot, problems } = await fetchEventsSnapshot({
		teams,
		seasons: seasonsToFetch(new Date()),
		previous: state.snapshot,
	});

	const first = !state.snapshot;
	state.snapshot = snapshot;

	if (problems.length) console.warn(`⚠️ Some FRC event data couldn't be refreshed: ${problems.join("; ")}`);
	if (first) {
		console.log(
			`🤖 FRC events: ${snapshot.events.length} for our ${teams.length} teams in ${snapshot.seasons.join(", ") || "no published seasons"}`,
		);
	}
}

function refresh(): Promise<void> {
	state.refreshing ??= updateSnapshot()
		.then(() => {
			if (state.failing) console.log("🤖 FRC event updates have recovered");
			state.failing = false;
		})
		.catch(err => {
			if (!state.failing) {
				const fallback = state.snapshot ? ", keeping the previous events" : "";
				console.error(`⚠️ FRC event update failed${fallback}: ${describeError(err)}`);
			}
			state.failing = true;
		})
		.finally(() => {
			state.refreshing = undefined;
		});

	return state.refreshing;
}

function start() {
	if (state.timer) return;

	state.timer = setInterval(() => void refresh(), RefreshIntervalMs);
	// Don't keep the process alive just for this
	state.timer.unref();

	void refresh();
}

async function waitFor(promise: Promise<unknown>, ms: number) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const elapsed = new Promise(resolve => {
		timeout = setTimeout(resolve, ms);
	});
	await Promise.race([promise, elapsed]);
	clearTimeout(timeout);
}

/**
 * Our teams' events, or null until the first fetch succeeds (or if refreshing has failed for days).
 *
 * The first call starts the background refresh.
 */
export async function getFrcEvents(): Promise<FrcEventsSnapshot | null> {
	start();

	// Right after startup, give the first fetch a moment rather than rendering without events
	if (!state.snapshot && state.refreshing) await waitFor(state.refreshing, FirstFetchWaitMs);

	const { snapshot } = state;
	if (!snapshot || Date.now() - snapshot.updated.getTime() > MaxSnapshotAgeMs) return null;

	return snapshot;
}

/** Which of our teams are at events overlapping `from`..`until`. For team prioritization (#8). */
export async function getTeamEvents(from: EventDate, until: EventDate): Promise<Map<Team, FrcEvent[]>> {
	const snapshot = await getFrcEvents();
	return snapshot ? eventsByTeam(snapshot.events, from, until) : new Map();
}
