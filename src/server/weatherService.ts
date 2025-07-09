import { env } from "../env.js";
import type { WeatherCondition, WeatherData, WeatherForecast, WeatherLocation } from "../types.js";

// WMO Weather interpretation codes
export const WMO_WEATHER_CODES = {
	0: "Clear sky",
	1: "Mainly clear",
	2: "Partly cloudy",
	3: "Overcast",
	45: "Fog",
	48: "Depositing rime fog",
	51: "Light drizzle",
	53: "Moderate drizzle",
	55: "Dense drizzle",
	56: "Light freezing drizzle",
	57: "Dense freezing drizzle",
	61: "Slight rain",
	63: "Moderate rain",
	65: "Heavy rain",
	66: "Light freezing rain",
	67: "Heavy freezing rain",
	71: "Slight snow fall",
	73: "Moderate snow fall",
	75: "Heavy snow fall",
	77: "Snow grains",
	80: "Slight rain showers",
	81: "Moderate rain showers",
	82: "Violent rain showers",
	85: "Slight snow showers",
	86: "Heavy snow showers",
	95: "Thunderstorm",
	96: "Thunderstorm with slight hail",
	99: "Thunderstorm with heavy hail",
} as const;

interface GeocodingResult {
	results: Array<{
		name: string;
		latitude: number;
		longitude: number;
		timezone: string;
		country: string;
		admin1?: string;
	}>;
}

interface WeatherApiResponse {
	latitude: number;
	longitude: number;
	timezone: string;
	hourly: {
		time: string[];
		temperature_2m: number[];
		weather_code: number[];
		precipitation_probability: number[];
		wind_speed_10m: number[];
	};
}

export class WeatherService {
	private geocodingCache = new Map<string, WeatherLocation>();
	private weatherCache: WeatherData | null = null;
	private updateInterval: NodeJS.Timeout | null = null;
	private persistCallback: ((data: WeatherData) => Promise<void>) | null = null;

	constructor() {
		this.initializeWeatherService();
	}

	setPersistCallback(callback: (data: WeatherData) => Promise<void>): void {
		this.persistCallback = callback;
	}

	private async initializeWeatherService(): Promise<void> {
		if (!env.WEATHER_LOCATION) {
			console.log("Weather location not configured, skipping weather service initialization");
			return;
		}

		try {
			// Start periodic weather updates
			await this.updateWeatherData();

			// Set up periodic updates - convert times per day to milliseconds
			const updateIntervalMs = (24 * 60 * 60 * 1000) / env.WEATHER_UPDATE_FREQUENCY;
			this.updateInterval = setInterval(async () => {
				try {
					await this.updateWeatherData();
				} catch (error) {
					console.error("Failed to update weather data:", error);
				}
			}, updateIntervalMs);

			console.log(`Weather service initialized. Updates every ${Math.round(updateIntervalMs / 1000 / 60)} minutes`);
		} catch (error) {
			console.error("Failed to initialize weather service:", error);
		}
	}

	async getLocation(cityName: string): Promise<WeatherLocation | null> {
		// Check cache first
		if (this.geocodingCache.has(cityName)) {
			const cached = this.geocodingCache.get(cityName);
			if (cached) {
				return cached;
			}
		}

		try {
			const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
			url.searchParams.set("name", cityName);
			url.searchParams.set("count", "1");
			url.searchParams.set("language", "en");
			url.searchParams.set("format", "json");

			const response = await fetch(url.toString());
			if (!response.ok) {
				throw new Error(`Geocoding API error: ${response.status}`);
			}

			const data = (await response.json()) as GeocodingResult;

			if (!data.results || data.results.length === 0) {
				console.warn(`No geocoding results found for: ${cityName}`);
				return null;
			}

			const result = data.results[0];
			if (!result) {
				console.warn(`No valid geocoding result found for: ${cityName}`);
				return null;
			}
			const location: WeatherLocation = {
				name: result.name,
				latitude: result.latitude,
				longitude: result.longitude,
				timezone: result.timezone,
				country: result.country,
				admin1: result.admin1,
			};

			// Cache the result
			this.geocodingCache.set(cityName, location);
			return location;
		} catch (error) {
			console.error(`Failed to geocode location "${cityName}":`, error);
			return null;
		}
	}

	async fetchWeatherData(location: WeatherLocation): Promise<WeatherCondition[]> {
		try {
			const url = new URL("https://api.open-meteo.com/v1/forecast");
			url.searchParams.set("latitude", location.latitude.toString());
			url.searchParams.set("longitude", location.longitude.toString());
			url.searchParams.set("timezone", location.timezone);
			url.searchParams.set("forecast_days", env.WEATHER_FORECAST_DAYS.toString());

			// Request hourly data
			url.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability,wind_speed_10m");

			if (env.OPENMETEO_API_KEY) {
				url.searchParams.set("apikey", env.OPENMETEO_API_KEY);
			}

			const response = await fetch(url.toString());
			if (!response.ok) {
				throw new Error(`Weather API error: ${response.status}`);
			}

			const data = (await response.json()) as WeatherApiResponse;

			// Process hourly data
			const hourlyData: WeatherCondition[] = [];
			for (let i = 0; i < data.hourly.time.length; i++) {
				const timeValue = data.hourly.time[i];
				if (!timeValue) continue;

				const time = new Date(timeValue);
				const temperature = data.hourly.temperature_2m[i] ?? 0;
				const weatherCode = data.hourly.weather_code[i] ?? 0;
				const precipitationProbability = data.hourly.precipitation_probability[i] ?? 0;
				const windSpeed = data.hourly.wind_speed_10m[i] ?? 0;

				hourlyData.push({
					time,
					temperature,
					weatherCode,
					precipitationProbability,
					windSpeed,
				});
			}

			return hourlyData;
		} catch (error) {
			console.error("Failed to fetch weather data:", error);
			throw error;
		}
	}

	async updateWeatherData(): Promise<void> {
		if (!env.WEATHER_LOCATION) {
			return;
		}

		try {
			const location = await this.getLocation(env.WEATHER_LOCATION);
			if (!location) {
				console.error(`Failed to find location: ${env.WEATHER_LOCATION}`);
				return;
			}

			const hourlyData = await this.fetchWeatherData(location);

			const forecast: WeatherForecast = {
				location,
				hourlyData,
				lastUpdated: new Date(),
			};

			this.weatherCache = {
				forecasts: [forecast],
				lastFetched: new Date(),
			};

			// Store in global backend storage and persist to file
			globalThis.__weatherData = this.weatherCache;

			// Call the backend persistence function directly
			if (this.persistCallback) {
				await this.persistCallback(this.weatherCache);
			}

			console.log(`Weather data updated for ${location.name}, ${location.country}`);
		} catch (error) {
			console.error("Failed to update weather data:", error);
		}
	}

	getWeatherData(): WeatherData | null {
		return this.weatherCache;
	}

	getWeatherForTimeSlot(date: Date, hour: number): WeatherCondition | null {
		if (!this.weatherCache) {
			return null;
		}

		const forecast = this.weatherCache.forecasts[0];
		if (!forecast) {
			return null;
		}

		// Find the closest hourly data point
		const targetTime = new Date(date);
		targetTime.setHours(hour, 0, 0, 0);

		let closestCondition: WeatherCondition | null = null;
		let closestTimeDiff = Number.POSITIVE_INFINITY;

		for (const condition of forecast.hourlyData) {
			const timeDiff = Math.abs(condition.time.getTime() - targetTime.getTime());
			if (timeDiff < closestTimeDiff) {
				closestTimeDiff = timeDiff;
				closestCondition = condition;
			}
		}

		return closestCondition;
	}

	destroy(): void {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
	}
}

// Global weather service instance
let weatherService: WeatherService | null = null;

export function getWeatherService(): WeatherService {
	if (!weatherService) {
		weatherService = new WeatherService();
	}
	return weatherService;
}

export function destroyWeatherService(): void {
	if (weatherService) {
		weatherService.destroy();
		weatherService = null;
	}
}
