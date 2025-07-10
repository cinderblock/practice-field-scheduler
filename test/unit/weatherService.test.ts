import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockedFunction } from "vitest";
import { WeatherService } from "~/server/weatherService";
import type { WeatherData, WeatherLocation } from "~/types";

// Mock the environment
vi.mock("~/env", () => ({
	env: {
		WEATHER_LOCATION: "Seattle",
		WEATHER_UPDATE_FREQUENCY: 96, // 4 times per day
		WEATHER_FORECAST_DAYS: 10,
		OPENMETEO_API_KEY: undefined,
	},
}));

// Mock fetch
global.fetch = vi.fn();
const mockFetch = vi.mocked(fetch);

describe("WeatherService", () => {
	let weatherService: WeatherService;
	const mockLocation: WeatherLocation = {
		name: "Seattle",
		latitude: 47.6062,
		longitude: -122.3321,
		timezone: "America/Los_Angeles",
		country: "US",
		admin1: "Washington",
	};

	const mockWeatherApiResponse = {
		latitude: 47.6062,
		longitude: -122.3321,
		timezone: "America/Los_Angeles",
		hourly: {
			time: ["2024-01-01T12:00:00Z", "2024-01-01T13:00:00Z", "2024-01-01T14:00:00Z", "2024-01-01T15:00:00Z"],
			temperature_2m: [10, 12, 14, 16],
			weather_code: [0, 1, 2, 3],
			precipitation_probability: [0, 10, 20, 30],
			wind_speed_10m: [5, 7, 9, 11],
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Set up default mock responses that may be used by the constructor
		// Individual tests will override these with their own mocks
		mockFetch
			.mockResolvedValue({
				ok: true,
				json: async () => ({ results: [mockLocation] }),
			} as Response)
			.mockResolvedValue({
				ok: true,
				json: async () => mockWeatherApiResponse,
			} as Response);

		weatherService = new WeatherService();
	});

	afterEach(() => {
		weatherService.destroy();
	});

	describe("getLocation", () => {
		it("should fetch and cache location data", async () => {
			// Clear mocks and set up fresh fetch response
			vi.clearAllMocks();

			const mockGeocodingResponse = {
				results: [
					{
						name: "Seattle",
						latitude: 47.6062,
						longitude: -122.3321,
						timezone: "America/Los_Angeles",
						country: "US",
						admin1: "Washington",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockGeocodingResponse,
			} as Response);

			const location = await weatherService.getLocation("Seattle");

			expect(location).toEqual(mockLocation);
			expect(fetch).toHaveBeenCalledWith(expect.stringContaining("https://geocoding-api.open-meteo.com/v1/search"));
		});

		it("should return cached location on subsequent calls", async () => {
			// Clear mocks and set up fresh fetch response
			vi.clearAllMocks();

			const mockGeocodingResponse = {
				results: [mockLocation],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockGeocodingResponse,
			} as Response);

			const location1 = await weatherService.getLocation("TestCity");
			const location2 = await weatherService.getLocation("TestCity");

			expect(location1).toEqual(location2);
			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("should return null for non-existent location", async () => {
			// Clear mocks and set up fresh fetch response
			vi.clearAllMocks();

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ results: [] }),
			} as Response);

			const location = await weatherService.getLocation("NonExistentCity");

			expect(location).toBeNull();
		});
	});

	describe("fetchWeatherData", () => {
		it("should fetch weather data for a location", async () => {
			// Clear mocks and set up fresh fetch response
			vi.clearAllMocks();

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockWeatherApiResponse,
			} as Response);

			const weatherData = await weatherService.fetchWeatherData(mockLocation);

			expect(weatherData).toHaveLength(4);
			expect(weatherData[0]).toEqual({
				time: new Date("2024-01-01T12:00:00Z"),
				temperature: 10,
				weatherCode: 0,
				precipitationProbability: 0,
				windSpeed: 5,
			});
		});

		it("should handle API errors", async () => {
			// Clear mocks and set up error response
			vi.clearAllMocks();

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
			} as Response);

			await expect(weatherService.fetchWeatherData(mockLocation)).rejects.toThrow("Weather API error: 500");
		});
	});

	describe("getWeatherForTimeSlot", () => {
		beforeEach(async () => {
			// Mock the fetch calls for initialization
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ results: [mockLocation] }),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => mockWeatherApiResponse,
				} as Response);

			await weatherService.updateWeatherData();
		});

		it("should return weather condition for exact hour", () => {
			const targetDate = new Date("2024-01-01T14:00:00Z");
			const condition = weatherService.getWeatherForTimeSlot(targetDate, 14);

			expect(condition).toEqual({
				time: new Date("2024-01-01T14:00:00Z"),
				temperature: 14,
				weatherCode: 2,
				precipitationProbability: 20,
				windSpeed: 9,
			});
		});

		it("should handle fractional hours properly", () => {
			const targetDate = new Date("2024-01-01T14:00:00Z");
			// 14.5 hours should resolve to 14:30
			const condition = weatherService.getWeatherForTimeSlot(targetDate, 14.5);

			// Should find the closest time point (14:00 in this case)
			expect(condition).toEqual({
				time: new Date("2024-01-01T14:00:00Z"),
				temperature: 14,
				weatherCode: 2,
				precipitationProbability: 20,
				windSpeed: 9,
			});
		});

		it("should return closest condition when exact time not found", () => {
			const targetDate = new Date("2024-01-01T16:30:00Z");
			const condition = weatherService.getWeatherForTimeSlot(targetDate, 16.5);

			// Should return the closest available time (15:00)
			expect(condition).toEqual({
				time: new Date("2024-01-01T15:00:00Z"),
				temperature: 16,
				weatherCode: 3,
				precipitationProbability: 30,
				windSpeed: 11,
			});
		});

		it("should return null when no weather data available", () => {
			// Create a fresh service without weather data
			const freshService = new WeatherService();
			// Clear the weather cache to simulate no data
			freshService.destroy();

			// Create a new service without triggering initialization
			const emptyService = Object.create(WeatherService.prototype);
			emptyService.weatherCache = null;

			const condition = emptyService.getWeatherForTimeSlot(new Date(), 14);

			expect(condition).toBeNull();
		});
	});

	describe("getWeatherData", () => {
		it("should return cached weather data", async () => {
			// Clear mocks and set up fresh fetch responses
			vi.clearAllMocks();

			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ results: [mockLocation] }),
				} as Response)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => mockWeatherApiResponse,
				} as Response);

			await weatherService.updateWeatherData();
			const data = weatherService.getWeatherData();

			expect(data).toBeDefined();
			expect(data?.forecasts).toHaveLength(1);
			expect(data?.forecasts[0]?.location).toEqual(mockLocation);
		});

		it("should return null when no data cached", () => {
			// Create a fresh service without weather data
			const emptyService = Object.create(WeatherService.prototype);
			emptyService.weatherCache = null;

			const data = emptyService.getWeatherData();

			expect(data).toBeNull();
		});
	});
});
