import { env } from "../env.js";
import type { WeatherCache, WeatherCondition, WeatherData } from "../types.js";

const GEOCODING_API_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";

export class WeatherService {
	private cache: WeatherCache | null = null;
	private updateInterval: NodeJS.Timeout | null = null;

	constructor() {
		if (env.WEATHER_LOCATION) {
			this.initializeWeatherService();
		}
	}

	private async initializeWeatherService() {
		try {
			// Initial fetch
			await this.updateWeatherData();

			// Schedule periodic updates
			const updateFrequency = env.WEATHER_UPDATE_FREQUENCY;
			const intervalMs = (24 * 60 * 60 * 1000) / updateFrequency; // Convert to milliseconds

			this.updateInterval = setInterval(async () => {
				try {
					await this.updateWeatherData();
				} catch (error) {
					console.error("Failed to update weather data:", error);
					// Continue running even if weather update fails
				}
			}, intervalMs);

			console.log(`Weather service initialized for ${env.WEATHER_LOCATION}, updating ${updateFrequency} times per day`);
		} catch (error) {
			console.error("Failed to initialize weather service:", error);
			// Don't throw error to prevent app startup failure
		}
	}

	private async geocodeLocation(location: string): Promise<{ latitude: number; longitude: number }> {
		try {
			const response = await fetch(
				`${GEOCODING_API_URL}?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
			);

			if (!response.ok) {
				throw new Error(`Geocoding API error: ${response.status}`);
			}

			const data = await response.json();

			if (!data.results || data.results.length === 0) {
				throw new Error(`Location not found: ${location}`);
			}

			const result = data.results[0];
			return {
				latitude: result.latitude,
				longitude: result.longitude,
			};
		} catch (error) {
			console.error(`Failed to geocode location "${location}":`, error);
			throw error;
		}
	}

	private mapWeatherCode(code: number): WeatherCondition {
		// WMO Weather interpretation codes
		// https://open-meteo.com/en/docs
		if (code === 0) return "clear";
		if (code <= 3) return "partly_cloudy";
		if (code <= 48) return "fog";
		if (code <= 67) return "rain";
		if (code <= 77) return "snow";
		if (code <= 82) return "rain";
		if (code <= 86) return "snow";
		if (code <= 99) return "thunderstorm";
		return "cloudy";
	}

	private async fetchWeatherData(latitude: number, longitude: number): Promise<WeatherData[]> {
		try {
			const forecastDays = env.WEATHER_FORECAST_DAYS;
			const apiKey = env.WEATHER_API_KEY;

			let url = `${WEATHER_API_URL}?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&forecast_days=${forecastDays}&timezone=auto`;

			if (apiKey) {
				url += `&apikey=${apiKey}`;
			}

			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Weather API error: ${response.status}`);
			}

			const data = await response.json();

			if (!data.hourly) {
				throw new Error("No hourly weather data available");
			}

			const weatherData: WeatherData[] = [];
			const now = new Date();

			for (let i = 0; i < data.hourly.time.length; i++) {
				weatherData.push({
					datetime: data.hourly.time[i],
					temperature: data.hourly.temperature_2m[i],
					condition: this.mapWeatherCode(data.hourly.weather_code[i]),
					precipitationProbability: data.hourly.precipitation_probability[i] || 0,
					windSpeed: data.hourly.wind_speed_10m[i] || 0,
					cached: now,
				});
			}

			return weatherData;
		} catch (error) {
			console.error("Failed to fetch weather data:", error);
			throw error;
		}
	}

	private async updateWeatherData(): Promise<void> {
		if (!env.WEATHER_LOCATION) {
			return;
		}

		try {
			const coordinates = await this.geocodeLocation(env.WEATHER_LOCATION);
			const weatherData = await this.fetchWeatherData(coordinates.latitude, coordinates.longitude);

			this.cache = {
				location: env.WEATHER_LOCATION,
				latitude: coordinates.latitude,
				longitude: coordinates.longitude,
				data: weatherData,
				lastUpdated: new Date(),
			};

			console.log(`Weather data updated for ${env.WEATHER_LOCATION} (${weatherData.length} data points)`);
		} catch (error) {
			console.error("Failed to update weather data:", error);
			throw error;
		}
	}

	public getWeatherCache(): WeatherCache | null {
		return this.cache;
	}

	public getWeatherForDateTime(datetime: string): WeatherData | null {
		if (!this.cache) {
			return null;
		}

		// Find the closest weather data point
		const targetTime = new Date(datetime);
		let closestData: WeatherData | null = null;
		let closestDiff = Number.POSITIVE_INFINITY;

		for (const data of this.cache.data) {
			const dataTime = new Date(data.datetime);
			const diff = Math.abs(targetTime.getTime() - dataTime.getTime());

			if (diff < closestDiff) {
				closestDiff = diff;
				closestData = data;
			}
		}

		return closestData;
	}

	public getWeatherForTimeSlot(date: string, slot: string): WeatherData[] {
		if (!this.cache) {
			return [];
		}

		const [hour, minute] = slot.split(":").map(Number);
		if (hour === undefined || minute === undefined) {
			return [];
		}

		const startTime = new Date(`${date}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`);

		// Get weather data for the time slot (typically 1 hour)
		const timeSlotData: WeatherData[] = [];

		for (const data of this.cache.data) {
			const dataTime = new Date(data.datetime);
			const timeDiff = Math.abs(dataTime.getTime() - startTime.getTime());

			// Include data within 1 hour of the time slot
			if (timeDiff <= 60 * 60 * 1000) {
				timeSlotData.push(data);
			}
		}

		return timeSlotData.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
	}

	public isWeatherEnabled(): boolean {
		return Boolean(env.WEATHER_LOCATION && this.cache);
	}

	public destroy(): void {
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
