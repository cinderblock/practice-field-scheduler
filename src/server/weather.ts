/**
 * Weather forecast for the field, from Open-Meteo (https://open-meteo.com).
 *
 * Enabled by setting WEATHER_LOCATION. The forecast is fetched in the background a configurable
 * number of times per day and cached in memory, so page loads never wait on the weather API except
 * briefly for the very first fetch after startup.
 */

import { z } from "zod";
import { env } from "~/env";
import type { WeatherForecast, WeatherSample } from "~/types";
import { getTimeSlots } from "./util/timeSlots";
import { type Coordinates, filterSamplesToHours, formatCoordinates, parseWeatherLocation } from "./util/weather";

const RequestTimeoutMs = 10 * 1000;
/** How long a page load will wait for the first forecast after startup */
const FirstFetchWaitMs = 3 * 1000;
/** A forecast this old is withheld rather than shown, if refreshing keeps failing */
const MaxForecastAgeMs = 24 * 60 * 60 * 1000;
/** Never refresh more often than this, whatever the configuration says */
const MinRefreshIntervalMs = 60 * 1000;

export class WeatherApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WeatherApiError";
	}
}

type ApiOptions = {
	/** Open-Meteo commercial API key. Switches to the customer endpoints. */
	apiKey?: string;
	/** Injectable for tests */
	fetch?: typeof fetch;
};

function apiUrl(service: "api" | "geocoding-api", path: string, apiKey: string | undefined) {
	const url = new URL(`https://${apiKey ? "customer-" : ""}${service}.open-meteo.com${path}`);
	if (apiKey) url.searchParams.set("apikey", apiKey);
	return url;
}

const ErrorResponse = z.object({ reason: z.string() });

async function getJson(url: URL, { fetch: fetchFn = fetch, apiKey }: ApiOptions): Promise<unknown> {
	// Never log the query string: it carries the API key
	const endpoint = `${url.origin}${url.pathname}`;

	let response: Response;
	try {
		response = await fetchFn(url, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(RequestTimeoutMs),
		});
	} catch (err) {
		let message = err instanceof Error ? err.message : String(err);
		// Some failures quote the URL they were fetching
		if (apiKey) message = message.replaceAll(apiKey, "<api key>");
		throw new WeatherApiError(`${endpoint} request failed: ${message}`);
	}

	const body: unknown = await response.json().catch(() => undefined);

	if (!response.ok) {
		const reason = ErrorResponse.safeParse(body);
		throw new WeatherApiError(
			`${endpoint} responded ${response.status}${reason.success ? `: ${reason.data.reason}` : ""}`,
		);
	}

	return body;
}

export type ResolvedLocation = Coordinates & {
	/** Human readable name, for logs and attribution */
	name: string;
};

const GeocodingResponse = z.object({
	// Open-Meteo omits `results` entirely when nothing matches
	results: z
		.array(
			z.object({
				name: z.string(),
				latitude: z.number(),
				longitude: z.number(),
				admin1: z.string().optional(),
				country_code: z.string().optional(),
			}),
		)
		.optional(),
});

/** Look up a place name or postal code. Qualifiers like "Springfield, IL" are honoured. */
export async function geocode(name: string, options: ApiOptions = {}): Promise<ResolvedLocation> {
	const url = apiUrl("geocoding-api", "/v1/search", options.apiKey);
	url.searchParams.set("name", name);
	url.searchParams.set("count", "1");
	url.searchParams.set("language", "en");
	url.searchParams.set("format", "json");

	const parsed = GeocodingResponse.safeParse(await getJson(url, options));
	if (!parsed.success) throw new WeatherApiError(`Unexpected geocoding response for "${name}"`);

	const place = parsed.data.results?.[0];
	if (!place) throw new WeatherApiError(`No place matches WEATHER_LOCATION "${name}"`);

	return {
		name: [place.name, place.admin1 ?? place.country_code].filter(Boolean).join(", "),
		latitude: place.latitude,
		longitude: place.longitude,
	};
}

export async function resolveLocation(setting: string, options: ApiOptions = {}): Promise<ResolvedLocation> {
	const location = parseWeatherLocation(setting);
	if (location.kind === "search") return geocode(location.name, options);

	const { latitude, longitude } = location;
	return { name: formatCoordinates(location), latitude, longitude };
}

const HourlyVariables = ["temperature_2m", "precipitation_probability", "weather_code", "is_day"] as const;

const ForecastResponse = z
	.object({
		hourly: z.object({
			time: z.array(z.number()),
			temperature_2m: z.array(z.number().nullable()),
			precipitation_probability: z.array(z.number().nullable()),
			weather_code: z.array(z.number().int().nullable()),
			is_day: z.array(z.union([z.literal(0), z.literal(1)]).nullable()),
		}),
	})
	.refine(
		({ hourly }) => HourlyVariables.every(variable => hourly[variable].length === hourly.time.length),
		"Hourly series have mismatched lengths",
	);

/** Fetch the hourly forecast, starting at midnight today in `timeZone`. */
export async function fetchForecast(
	{ latitude, longitude }: Coordinates,
	{ days, timeZone, ...options }: ApiOptions & { days: number; timeZone: string },
): Promise<WeatherSample[]> {
	const url = apiUrl("api", "/v1/forecast", options.apiKey);
	url.searchParams.set("latitude", latitude.toString());
	url.searchParams.set("longitude", longitude.toString());
	url.searchParams.set("hourly", HourlyVariables.join(","));
	url.searchParams.set("forecast_days", days.toString());
	// Aligns the forecast's days with the site's. Times still come back as absolute instants, so
	// nothing downstream has to guess what "local" meant (or cope with DST days being 23/25 hours).
	url.searchParams.set("timezone", timeZone);
	url.searchParams.set("timeformat", "unixtime");
	url.searchParams.set("temperature_unit", "celsius");

	const parsed = ForecastResponse.safeParse(await getJson(url, options));
	if (!parsed.success) throw new WeatherApiError(`Unexpected forecast response: ${parsed.error.message}`);

	const { time, temperature_2m, precipitation_probability, weather_code, is_day } = parsed.data.hourly;

	return time.map((seconds, i) => {
		const isDay = is_day[i] ?? null;
		return {
			time: seconds * 1000,
			temperature: temperature_2m[i] ?? null,
			precipitationProbability: precipitation_probability[i] ?? null,
			weatherCode: weather_code[i] ?? null,
			isDay: isDay === null ? null : isDay === 1,
		};
	});
}

////// Background refresh and cache //////

type WeatherState = {
	/** WEATHER_LOCATION the cached location was resolved from */
	locationSetting?: string;
	location?: ResolvedLocation;
	forecast?: WeatherForecast;
	refreshing?: Promise<void>;
	timer?: ReturnType<typeof setInterval>;
	/** Set while refreshes are failing, so a long outage logs once rather than every interval */
	failing?: boolean;
};

// Global storage for HMR persistence
declare global {
	var __weather: WeatherState | undefined;
}

globalThis.__weather ||= {};
const state = globalThis.__weather;

// A reloaded module (dev HMR) must not leave the previous module's timer running its stale code
if (state.timer) {
	clearInterval(state.timer);
	state.timer = undefined;
}

async function updateForecast(setting: string) {
	const options: ApiOptions = { apiKey: env.WEATHER_API_KEY };

	if (!state.location || state.locationSetting !== setting) {
		state.location = await resolveLocation(setting, options);
		state.locationSetting = setting;
		const { name, latitude, longitude } = state.location;
		console.log(`🌤️ Weather forecasts for ${name} (${latitude}, ${longitude})`);
	}

	const timeZone = env.NEXT_PUBLIC_TIME_ZONE;
	const samples = await fetchForecast(state.location, { ...options, days: env.WEATHER_FORECAST_DAYS, timeZone });

	const slots = getTimeSlots();
	const startHour = slots[0]?.startHour;
	const endHour = slots[slots.length - 1]?.endHour;
	if (startHour === undefined || endHour === undefined) throw new Error("TimeSlotBorders is empty");

	state.forecast = {
		location: state.location.name,
		updated: new Date(),
		// The calendar only shows reservable hours, so there's no point shipping the night
		samples: filterSamplesToHours(samples, { timeZone, startHour, endHour }),
	};
}

function refresh(setting: string): Promise<void> {
	state.refreshing ??= updateForecast(setting)
		.then(() => {
			if (state.failing) console.log("🌤️ Weather forecast updates have recovered");
			state.failing = false;
		})
		.catch(err => {
			if (!state.failing) {
				const message = err instanceof Error ? err.message : String(err);
				const fallback = state.forecast ? ", keeping the previous forecast" : "";
				console.error(`⚠️ Weather forecast update failed${fallback}: ${message}`);
			}
			state.failing = true;
		})
		.finally(() => {
			state.refreshing = undefined;
		});

	return state.refreshing;
}

function start(setting: string) {
	if (state.timer) return;

	// With validation skipped (SKIP_ENV_VALIDATION) this could be missing, and a NaN interval would
	// become 1ms: hammering a free API. Hence the fallback and the floor.
	const perDay = Number(env.WEATHER_UPDATES_PER_DAY);
	const intervalMs = Math.max((24 * 60 * 60 * 1000) / (perDay > 0 ? perDay : 96), MinRefreshIntervalMs);
	state.timer = setInterval(() => void refresh(setting), intervalMs);
	// Don't keep the process alive just for the weather
	state.timer.unref();

	void refresh(setting);
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
 * The cached forecast, or null if weather is disabled or no usable forecast is available.
 *
 * The first call starts the background refresh.
 */
export async function getWeatherForecast(): Promise<WeatherForecast | null> {
	const setting = env.WEATHER_LOCATION;
	if (!setting) return null;

	start(setting);

	// Right after startup, give the first fetch a moment rather than rendering without weather
	if (!state.forecast && state.refreshing) await waitFor(state.refreshing, FirstFetchWaitMs);

	const { forecast } = state;
	if (!forecast || Date.now() - forecast.updated.getTime() > MaxForecastAgeMs) return null;

	return forecast;
}
