import { fetchWeatherApi } from "openmeteo";
import { env } from "~/env.js";
import type { WeatherData, WeatherForecast, EventDate } from "~/types";

let cachedWeatherForecast: WeatherForecast | null = null;
let lastFetchTime = 0;

// Convert city name to coordinates using OpenMeteo's geocoding API
async function getCoordinatesFromCity(cityName: string): Promise<{ latitude: number; longitude: number }> {
	const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;
	
	try {
		const response = await fetch(geocodingUrl);
		const data = await response.json();
		
		if (!data.results || data.results.length === 0) {
			throw new Error(`No location found for "${cityName}"`);
		}
		
		const result = data.results[0];
		return {
			latitude: result.latitude,
			longitude: result.longitude,
		};
	} catch (error) {
		console.error("Error fetching coordinates:", error);
		throw error;
	}
}

// Fetch weather data from OpenMeteo API
async function fetchWeatherData(latitude: number, longitude: number): Promise<WeatherData[]> {
	const params = {
		latitude: [latitude],
		longitude: [longitude],
		hourly: ["temperature_2m", "weather_code"],
		forecast_days: env.WEATHER_FORECAST_DAYS,
		timezone: "auto",
		...(env.WEATHER_API_KEY && { apikey: env.WEATHER_API_KEY }),
	};

	try {
		const responses = await fetchWeatherApi("https://api.open-meteo.com/v1/forecast", params);
		const response = responses[0]!;

		const hourly = response.hourly()!;
		const temperatures = hourly.variables(0)!.valuesArray()!; // temperature_2m
		const weatherCodes = hourly.variables(1)!.valuesArray()!; // weather_code

		const weatherData: WeatherData[] = [];
		const now = new Date();

		// Group hourly data by date
		for (let day = 0; day < env.WEATHER_FORECAST_DAYS; day++) {
			const date = new Date(now);
			date.setDate(date.getDate() + day);
			const dateString = date.toISOString().slice(0, 10) as EventDate;

			const dayStart = day * 24;
			const dayEnd = dayStart + 24;

			weatherData.push({
				date: dateString,
				hourlyTemperatures: Array.from(temperatures.slice(dayStart, dayEnd)),
				weatherCodes: Array.from(weatherCodes.slice(dayStart, dayEnd)),
				updated: now,
			});
		}

		return weatherData;
	} catch (error) {
		console.error("Error fetching weather data:", error);
		throw error;
	}
}

// Get weather forecast, using cache if available and recent
export async function getWeatherForecast(): Promise<WeatherForecast | null> {
	if (!env.WEATHER_LOCATION) {
		return null;
	}

	const now = Date.now();
	const fetchIntervalMs = Math.floor((24 * 60 * 60 * 1000) / env.WEATHER_FETCH_FREQUENCY); // Convert daily frequency to milliseconds

	// Return cached data if it's still fresh
	if (cachedWeatherForecast && (now - lastFetchTime) < fetchIntervalMs) {
		return cachedWeatherForecast;
	}

	try {
		console.log(`Fetching weather data for: ${env.WEATHER_LOCATION}`);
		
		// Get coordinates from city name
		const { latitude, longitude } = await getCoordinatesFromCity(env.WEATHER_LOCATION);
		
		// Fetch weather data
		const weatherData = await fetchWeatherData(latitude, longitude);

		// Update cache
		cachedWeatherForecast = {
			location: env.WEATHER_LOCATION,
			latitude,
			longitude,
			data: weatherData,
			lastUpdated: new Date(),
		};

		lastFetchTime = now;
		console.log("Weather data updated successfully");

		return cachedWeatherForecast;
	} catch (error) {
		console.error("Failed to fetch weather data:", error);
		// Return cached data if available, even if stale
		return cachedWeatherForecast;
	}
}

// Get weather for a specific date
export function getWeatherForDate(date: EventDate): WeatherData | null {
	if (!cachedWeatherForecast) {
		return null;
	}

	return cachedWeatherForecast.data.find(day => day.date === date) || null;
}

// Initialize weather data on server startup
export async function initializeWeatherService(): Promise<void> {
	if (env.WEATHER_LOCATION) {
		console.log("Initializing weather service...");
		await getWeatherForecast();
	}
}

// Weather code to icon mapping (WMO Weather interpretation codes)
export function getWeatherIcon(weatherCode: number): string {
	// Simplified weather code mapping
	if (weatherCode === 0) return "☀️"; // Clear sky
	if (weatherCode >= 1 && weatherCode <= 3) return "⛅"; // Partly cloudy
	if (weatherCode >= 45 && weatherCode <= 48) return "🌫️"; // Fog
	if (weatherCode >= 51 && weatherCode <= 67) return "🌧️"; // Rain
	if (weatherCode >= 71 && weatherCode <= 77) return "❄️"; // Snow
	if (weatherCode >= 80 && weatherCode <= 82) return "🌦️"; // Rain showers
	if (weatherCode >= 95 && weatherCode <= 99) return "⛈️"; // Thunderstorm
	return "🌤️"; // Default
}

// Get weather description from code
export function getWeatherDescription(weatherCode: number): string {
	if (weatherCode === 0) return "Clear sky";
	if (weatherCode === 1) return "Mainly clear";
	if (weatherCode === 2) return "Partly cloudy";
	if (weatherCode === 3) return "Overcast";
	if (weatherCode >= 45 && weatherCode <= 48) return "Fog";
	if (weatherCode >= 51 && weatherCode <= 67) return "Rain";
	if (weatherCode >= 71 && weatherCode <= 77) return "Snow";
	if (weatherCode >= 80 && weatherCode <= 82) return "Rain showers";
	if (weatherCode >= 95 && weatherCode <= 99) return "Thunderstorm";
	return "Unknown";
}