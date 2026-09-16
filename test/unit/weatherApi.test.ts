import { describe, expect, it, vi } from "vitest";
import { fetchForecast, geocode, getWeatherForecast, resolveLocation, WeatherApiError } from "~/server/weather";

function mockFetch(body: unknown, status = 200) {
	const calls: URL[] = [];
	const fetch = vi.fn(async (input: string | URL | Request) => {
		calls.push(new URL(input instanceof Request ? input.url : input));
		return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	});
	return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const Coordinates = { latitude: 37.34, longitude: -121.89 };
const ForecastOptions = { days: 10, timeZone: "America/Los_Angeles" };

const ForecastBody = {
	latitude: 37.347546,
	longitude: -121.88084,
	timezone: "America/Los_Angeles",
	hourly_units: {
		time: "unixtime",
		temperature_2m: "°C",
		precipitation_probability: "%",
		weather_code: "wmo code",
		is_day: "",
	},
	hourly: {
		time: [1789542000, 1789545600, 1789549200],
		temperature_2m: [14.2, null, 13.8],
		precipitation_probability: [0, 5, null],
		weather_code: [3, 61, null],
		is_day: [0, 1, null],
	},
};

describe("fetchForecast", () => {
	it("requests hourly temperature and chance of rain aligned to the site's days", async () => {
		const { fetch, calls } = mockFetch(ForecastBody);
		await fetchForecast(Coordinates, { ...ForecastOptions, fetch });

		const url = calls[0];
		expect(url?.origin).toBe("https://api.open-meteo.com");
		expect(url?.pathname).toBe("/v1/forecast");
		expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
			latitude: "37.34",
			longitude: "-121.89",
			hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
			forecast_days: "10",
			timezone: "America/Los_Angeles",
			timeformat: "unixtime",
			temperature_unit: "celsius",
		});
	});

	it("uses the commercial endpoint when given an API key", async () => {
		const { fetch, calls } = mockFetch(ForecastBody);
		await fetchForecast(Coordinates, { ...ForecastOptions, apiKey: "secret-key", fetch });

		expect(calls[0]?.origin).toBe("https://customer-api.open-meteo.com");
		expect(calls[0]?.searchParams.get("apikey")).toBe("secret-key");
	});

	it("returns samples with millisecond times, keeping gaps as null", async () => {
		const { fetch } = mockFetch(ForecastBody);

		expect(await fetchForecast(Coordinates, { ...ForecastOptions, fetch })).toEqual([
			{ time: 1789542000000, temperature: 14.2, precipitationProbability: 0, weatherCode: 3, isDay: false },
			{ time: 1789545600000, temperature: null, precipitationProbability: 5, weatherCode: 61, isDay: true },
			{ time: 1789549200000, temperature: 13.8, precipitationProbability: null, weatherCode: null, isDay: null },
		]);
	});

	it.each(["temperature_2m", "precipitation_probability", "weather_code", "is_day"])(
		"rejects a response whose %s doesn't line up with the times",
		async variable => {
			const { fetch } = mockFetch({ hourly: { ...ForecastBody.hourly, [variable]: [1] } });

			await expect(fetchForecast(Coordinates, { ...ForecastOptions, fetch })).rejects.toThrow(WeatherApiError);
		},
	);

	it("rejects a response missing a variable", async () => {
		const { weather_code: _, ...hourly } = ForecastBody.hourly;
		const { fetch } = mockFetch({ hourly });

		await expect(fetchForecast(Coordinates, { ...ForecastOptions, fetch })).rejects.toThrow(WeatherApiError);
	});

	it("reports the API's reason for an error, without leaking the key", async () => {
		const { fetch } = mockFetch({ error: true, reason: "Latitude must be in range of -90 to 90°." }, 400);
		const error = await fetchForecast(Coordinates, { ...ForecastOptions, apiKey: "secret-key", fetch }).catch(
			(e: unknown) => e,
		);

		expect(error).toBeInstanceOf(WeatherApiError);
		expect((error as Error).message).toBe(
			"https://customer-api.open-meteo.com/v1/forecast responded 400: Latitude must be in range of -90 to 90°.",
		);
	});

	it("wraps network failures, without leaking the key", async () => {
		// A failure that quotes the URL it was fetching, key and all
		const fetch = vi.fn(async (input: string | URL | Request) => {
			throw new TypeError(`fetch failed for ${String(input)}`);
		}) as unknown as typeof globalThis.fetch;
		const error = await fetchForecast(Coordinates, { ...ForecastOptions, apiKey: "secret-key", fetch }).catch(
			(e: unknown) => e,
		);

		expect(error).toBeInstanceOf(WeatherApiError);
		expect((error as Error).message).toContain("request failed: fetch failed for https://customer-api");
		expect((error as Error).message).not.toContain("secret-key");
	});
});

describe("geocode", () => {
	const SanJose = {
		results: [
			{
				id: 5392171,
				name: "San Jose",
				latitude: 37.33939,
				longitude: -121.89496,
				country_code: "US",
				admin1: "California",
			},
		],
		generationtime_ms: 0.5,
	};

	it("resolves a place to coordinates and a readable name", async () => {
		const { fetch, calls } = mockFetch(SanJose);

		expect(await geocode("San Jose, CA", { fetch })).toEqual({
			name: "San Jose, California",
			latitude: 37.33939,
			longitude: -121.89496,
		});
		expect(calls[0]?.origin).toBe("https://geocoding-api.open-meteo.com");
		expect(calls[0]?.searchParams.get("name")).toBe("San Jose, CA");
		expect(calls[0]?.searchParams.get("count")).toBe("1");
	});

	it("uses the commercial endpoint when given an API key", async () => {
		const { fetch, calls } = mockFetch(SanJose);
		await geocode("San Jose", { apiKey: "secret-key", fetch });

		expect(calls[0]?.origin).toBe("https://customer-geocoding-api.open-meteo.com");
	});

	it("explains when nothing matches", async () => {
		// Open-Meteo leaves `results` out entirely when there's no match
		const { fetch } = mockFetch({ generationtime_ms: 0.5 });

		await expect(geocode("Nowhereville", { fetch })).rejects.toThrow(
			'No place matches WEATHER_LOCATION "Nowhereville"',
		);
	});
});

describe("resolveLocation", () => {
	it("uses coordinates as given, without a lookup", async () => {
		const { fetch } = mockFetch({});

		expect(await resolveLocation("37.3394, -121.895", { fetch })).toEqual({
			name: "37.3394° N, 121.8950° W",
			latitude: 37.3394,
			longitude: -121.895,
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it("looks up anything else", async () => {
		const { fetch } = mockFetch({ results: [{ name: "Springfield", latitude: 39.8, longitude: -89.64 }] });

		expect(await resolveLocation("Springfield, IL", { fetch })).toMatchObject({ name: "Springfield" });
		expect(fetch).toHaveBeenCalledOnce();
	});
});

describe("getWeatherForecast", () => {
	it.skipIf(!!process.env.WEATHER_LOCATION)("is null when no location is configured", async () => {
		expect(await getWeatherForecast()).toBeNull();
	});
});
