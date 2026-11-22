/**
 * Events from the site's own calendar, shown on the reservation calendar.
 *
 * Enabled by setting SITE_CALENDAR_ICS_URL (for a Google Calendar, its "Secret address in iCal
 * format"). The feed is fetched in the background and cached in memory, like the weather, so page
 * loads never wait on it except briefly for the very first fetch after startup.
 *
 * Display only: site events never affect booking. Blackouts are what close the field.
 *
 * The URL is a credential (anyone holding it can read the calendar), so it is never logged, not
 * even inside a wrapped fetch error.
 */

import { env } from "~/env";
import type { SiteCalendarEvent } from "~/types";
import { parseSiteCalendar } from "./util/siteCalendar";

const RequestTimeoutMs = 15 * 1000;
/** How long a page load will wait for the first fetch after startup */
const FirstFetchWaitMs = 3 * 1000;
/** Google regenerates its secret iCal feeds on its own schedule, so polling faster gains little */
const RefreshIntervalMs = 15 * 60 * 1000;
/** Events this stale are withheld rather than shown, if refreshing keeps failing */
const MaxAgeMs = 24 * 60 * 60 * 1000;
/** How far back to keep events, for the calendar's "load history" */
const HistoryDays = 35;
/** How far ahead to keep events; comfortably more than the calendar ever shows */
const AheadDays = 60;

const DayMs = 24 * 60 * 60 * 1000;

export class SiteCalendarError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SiteCalendarError";
	}
}

/** Remove every trace of the secret URL from a message */
function redact(message: string, url: string): string {
	let redacted = message.replaceAll(url, "<site calendar URL>");
	try {
		// Google's secret lives in the path, which an error may quote without the host
		const { pathname, search } = new URL(url);
		if (search.length > 1) redacted = redacted.replaceAll(search.slice(1), "<secret>");
		if (pathname.length > 1) redacted = redacted.replaceAll(pathname, "/<secret>");
	} catch {
		// Not a URL: the whole-string replacement above is all we can do
	}
	return redacted;
}

/** Fetch and parse the feed. `fetchFn` is injectable for tests. */
export async function fetchSiteCalendar(
	url: string,
	{ now = new Date(), timeZone, fetch: fetchFn = fetch }: { now?: Date; timeZone: string; fetch?: typeof fetch },
): Promise<SiteCalendarEvent[]> {
	let response: Response;
	try {
		response = await fetchFn(url, {
			headers: { accept: "text/calendar" },
			signal: AbortSignal.timeout(RequestTimeoutMs),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SiteCalendarError(`Site calendar request failed: ${redact(message, url)}`);
	}

	if (!response.ok) throw new SiteCalendarError(`Site calendar responded ${response.status}`);

	const text = await response.text();
	try {
		return parseSiteCalendar(text, {
			from: new Date(now.getTime() - HistoryDays * DayMs),
			until: new Date(now.getTime() + AheadDays * DayMs),
			timeZone,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new SiteCalendarError(`Site calendar isn't valid iCalendar: ${redact(message, url)}`);
	}
}

////// Background refresh and cache //////

type SiteCalendarState = {
	/** SITE_CALENDAR_ICS_URL the cached events came from */
	url?: string;
	events?: SiteCalendarEvent[];
	updated?: Date;
	refreshing?: Promise<void>;
	timer?: ReturnType<typeof setInterval>;
	/** Set while refreshes are failing, so a long outage logs once rather than every interval */
	failing?: boolean;
};

// Global storage for HMR persistence
declare global {
	var __siteCalendar: SiteCalendarState | undefined;
}

globalThis.__siteCalendar ||= {};
const state = globalThis.__siteCalendar;

// A reloaded module (dev HMR) must not leave the previous module's timer running its stale code
if (state.timer) {
	clearInterval(state.timer);
	state.timer = undefined;
}

function refresh(url: string): Promise<void> {
	state.refreshing ??= fetchSiteCalendar(url, { timeZone: env.TIME_ZONE })
		.then(events => {
			if (state.failing) console.log("📅 Site calendar updates have recovered");
			else if (!state.events) console.log(`📅 Site calendar loaded (${events.length} upcoming events)`);
			state.failing = false;
			state.url = url;
			state.events = events;
			state.updated = new Date();
		})
		.catch(err => {
			if (!state.failing) {
				const message = err instanceof Error ? err.message : String(err);
				const fallback = state.events ? ", keeping the previous events" : "";
				console.error(`⚠️ Site calendar update failed${fallback}: ${redact(message, url)}`);
			}
			state.failing = true;
		})
		.finally(() => {
			state.refreshing = undefined;
		});

	return state.refreshing;
}

function start(url: string) {
	if (state.timer) return;

	state.timer = setInterval(() => void refresh(url), RefreshIntervalMs);
	// Don't keep the process alive just for the calendar
	state.timer.unref();

	void refresh(url);
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
 * The cached site events, or an empty list if the calendar is disabled or nothing usable has been
 * fetched. The first call starts the background refresh.
 */
export async function getSiteCalendarEvents(): Promise<SiteCalendarEvent[]> {
	const url = env.SITE_CALENDAR_ICS_URL;
	if (!url) return [];

	start(url);

	// Right after startup, give the first fetch a moment rather than rendering without events
	if (!state.events && state.refreshing) await waitFor(state.refreshing, FirstFetchWaitMs);

	const { events, updated } = state;
	if (!events || !updated || state.url !== url || Date.now() - updated.getTime() > MaxAgeMs) return [];

	return events;
}
