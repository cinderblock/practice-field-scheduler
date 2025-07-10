import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock NextAuth dependencies before importing anything else
vi.mock("next/server", () => ({
	NextRequest: vi.fn(),
	NextResponse: {
		json: vi.fn(),
		redirect: vi.fn(),
	},
}));

// Mock the auth module
vi.mock("~/server/auth", () => ({
	auth: vi.fn().mockResolvedValue(null),
}));

// Mock the tRPC middleware to bypass authorization
vi.mock("~/server/api/trpc", async importOriginal => {
	const actual = await importOriginal<typeof import("~/server/api/trpc")>();
	return {
		...actual,
		protectedProcedure: actual.publicProcedure, // Use publicProcedure instead of protectedProcedure
	};
});

// Mock the backend context
vi.mock("~/server/backend", () => ({
	Context: vi.fn().mockImplementation(() => ({
		getWeatherData: vi.fn(),
	})),
}));

import { weatherRouter } from "~/server/api/routers/weather";
import { Context } from "~/server/backend";
import type { WeatherData, WeatherLocation } from "~/types";

// Mock the environment
vi.mock("~/env", () => ({
	env: {
		WEATHER_LOCATION: "Seattle",
		WEATHER_UPDATE_FREQUENCY: 96,
		WEATHER_FORECAST_DAYS: 10,
		OPENMETEO_API_KEY: undefined,
		NEXT_PUBLIC_TIME_SLOT_BORDERS: [-2, 1, 4, 7],
	},
}));

// Mock the weather service
const mockWeatherService = {
	getWeatherData: vi.fn(),
	getWeatherForTimeSlot: vi.fn(),
};

vi.mock("~/server/weatherService", () => ({
	getWeatherService: () => mockWeatherService,
}));

describe("Weather tRPC Router", () => {
	const mockLocation: WeatherLocation = {
		name: "Seattle",
		latitude: 47.6062,
		longitude: -122.3321,
		timezone: "America/Los_Angeles",
		country: "US",
		admin1: "Washington",
	};

	const mockWeatherData: WeatherData = {
		forecasts: [
			{
				location: mockLocation,
				hourlyData: [
					{
						time: new Date("2024-01-01T12:00:00Z"),
						temperature: 10,
						weatherCode: 0,
						precipitationProbability: 0,
						windSpeed: 5,
					},
					{
						time: new Date("2024-01-01T13:00:00Z"),
						temperature: 12,
						weatherCode: 1,
						precipitationProbability: 10,
						windSpeed: 7,
					},
					{
						time: new Date("2024-01-01T14:00:00Z"),
						temperature: 14,
						weatherCode: 2,
						precipitationProbability: 20,
						windSpeed: 9,
					},
					{
						time: new Date("2024-01-01T15:00:00Z"),
						temperature: 16,
						weatherCode: 3,
						precipitationProbability: 30,
						windSpeed: 11,
					},
				],
				lastUpdated: new Date("2024-01-01T10:00:00Z"),
			},
		],
		lastFetched: new Date("2024-01-01T10:00:00Z"),
	};

	const mockSession = {
		user: { id: "test-user" },
		expires: new Date(Date.now() + 3600000).toISOString(),
	};

	const mockContext = {
		context: {
			getWeatherData: vi.fn(),
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Mock the getWeatherData method on the context instance
		mockContext.context.getWeatherData.mockResolvedValue(mockWeatherData);
	});

	describe("getWeatherForecast", () => {
		it("should return weather forecast data", async () => {
			mockContext.context.getWeatherData.mockResolvedValueOnce(mockWeatherData);

			const caller = weatherRouter.createCaller(mockContext);
			const result = await caller.getWeatherForecast();

			expect(result).toEqual(mockWeatherData);
			expect(mockContext.context.getWeatherData).toHaveBeenCalledOnce();
		});
	});

	describe("getTimeSlotWeather", () => {
		beforeEach(() => {
			mockWeatherService.getWeatherData.mockReturnValue(mockWeatherData);
		});

		it("should return empty array when no weather location configured", async () => {
			// Mock env without WEATHER_LOCATION
			vi.doMock("~/env", () => ({
				env: {
					WEATHER_LOCATION: undefined,
					NEXT_PUBLIC_TIME_SLOT_BORDERS: [-2, 1, 4, 7],
				},
			}));

			const caller = weatherRouter.createCaller(mockContext);
			const result = await caller.getTimeSlotWeather({
				date: "2024-01-01",
				slots: ["12:00"],
			});

			expect(result).toEqual([]);
		});

		it("should return weather for time slots", async () => {
			// Mock weather service responses
			mockWeatherService.getWeatherForTimeSlot
				.mockReturnValueOnce({
					time: new Date("2024-01-01T10:00:00Z"),
					temperature: 10,
					weatherCode: 0,
					precipitationProbability: 0,
					windSpeed: 5,
				}) // start
				.mockReturnValueOnce({
					time: new Date("2024-01-01T11:30:00Z"),
					temperature: 13,
					weatherCode: 1,
					precipitationProbability: 15,
					windSpeed: 8,
				}) // middle
				.mockReturnValueOnce({
					time: new Date("2024-01-01T13:00:00Z"),
					temperature: 16,
					weatherCode: 2,
					precipitationProbability: 25,
					windSpeed: 10,
				}); // end

			const caller = weatherRouter.createCaller(mockContext);
			const result = await caller.getTimeSlotWeather({
				date: "2024-01-01",
				slots: ["10:00"], // This maps to time slot border index 0 (-2 + 12 = 10)
			});

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				slot: "10:00",
				date: "2024-01-01",
				startTemp: 10,
				middleTemp: 13,
				endTemp: 16,
				weatherCode: 1, // middle condition
				precipitationProbability: 25, // max of all three
				windSpeed: 8, // middle condition
			});
		});

		it("should handle fractional middle hour correctly", async () => {
			// Mock weather service to verify fractional hour handling
			mockWeatherService.getWeatherForTimeSlot
				.mockReturnValueOnce({
					time: new Date("2024-01-01T12:00:00Z"),
					temperature: 10,
					weatherCode: 0,
					precipitationProbability: 0,
					windSpeed: 5,
				}) // start: 10:00 (hour -2+12)
				.mockReturnValueOnce({
					time: new Date("2024-01-01T13:30:00Z"),
					temperature: 13,
					weatherCode: 1,
					precipitationProbability: 15,
					windSpeed: 8,
				}) // middle: 11.5 (hour -0.5+12)
				.mockReturnValueOnce({
					time: new Date("2024-01-01T15:00:00Z"),
					temperature: 16,
					weatherCode: 2,
					precipitationProbability: 25,
					windSpeed: 10,
				}); // end: 13:00 (hour 1+12)

			const caller = weatherRouter.createCaller(mockContext);
			await caller.getTimeSlotWeather({
				date: "2024-01-01",
				slots: ["10:00"], // Maps to border index 0 (-2+12=10)
			});

			// Verify that getWeatherForTimeSlot was called with fractional hour
			expect(mockWeatherService.getWeatherForTimeSlot).toHaveBeenCalledWith(
				new Date("2024-01-01"),
				11.5, // middle hour: 10 + (13-10)/2 = 11.5
			);
		});

		it("should share temperatures between adjacent slots", async () => {
			mockWeatherService.getWeatherForTimeSlot
				.mockReturnValueOnce({
					temperature: 10,
					weatherCode: 0,
					precipitationProbability: 0,
					windSpeed: 5,
				}) // first slot start
				.mockReturnValueOnce({
					temperature: 13,
					weatherCode: 1,
					precipitationProbability: 15,
					windSpeed: 8,
				}) // first slot middle
				.mockReturnValueOnce({
					temperature: 16,
					weatherCode: 2,
					precipitationProbability: 25,
					windSpeed: 10,
				}) // first slot end
				.mockReturnValueOnce({
					temperature: 16, // Same as previous end temp to trigger sharing
					weatherCode: 2,
					precipitationProbability: 25,
					windSpeed: 10,
				}) // second slot start (same as first end)
				.mockReturnValueOnce({
					temperature: 18,
					weatherCode: 1,
					precipitationProbability: 20,
					windSpeed: 12,
				}) // second slot middle
				.mockReturnValueOnce({
					temperature: 20,
					weatherCode: 0,
					precipitationProbability: 5,
					windSpeed: 15,
				}); // second slot end

			const caller = weatherRouter.createCaller(mockContext);
			const result = await caller.getTimeSlotWeather({
				date: "2024-01-01",
				slots: ["10:00", "13:00"], // Adjacent slots
			});

			expect(result).toHaveLength(2);
			expect(result[0]?.startTemp).toBe(10);
			expect(result[0]?.endTemp).toBe(16);
			expect(result[1]?.startTemp).toBeUndefined(); // Shared temperature
			expect(result[1]?.endTemp).toBe(20);
		});

		it("should handle missing weather data gracefully", async () => {
			mockWeatherService.getWeatherData.mockReturnValue(null);

			const caller = weatherRouter.createCaller(mockContext);
			const result = await caller.getTimeSlotWeather({
				date: "2024-01-01",
				slots: ["12:00"],
			});

			expect(result).toEqual([]);
		});

		it("should validate input format", async () => {
			const caller = weatherRouter.createCaller(mockContext);

			// Invalid date format
			await expect(
				caller.getTimeSlotWeather({
					date: "2024/01/01",
					slots: ["12:00"],
				}),
			).rejects.toThrow();

			// Invalid slot format
			await expect(
				caller.getTimeSlotWeather({
					date: "2024-01-01",
					slots: ["12:00pm"],
				}),
			).rejects.toThrow();
		});
	});
});
