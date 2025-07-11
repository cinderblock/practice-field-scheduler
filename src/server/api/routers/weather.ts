import { z } from "zod";
import { env } from "~/env.js";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getWeatherForDate, getWeatherForecast } from "~/server/weatherService";
import type { TimeSlotWeather } from "~/types";

export const weatherRouter = createTRPCRouter({
	// Get complete weather forecast
	getForecast: publicProcedure.query(async () => {
		return await getWeatherForecast();
	}),

	// Get weather for a specific date
	getWeatherForDate: publicProcedure.input(z.object({ date: z.string() })).query(async ({ input }) => {
		return getWeatherForDate(input.date);
	}),

	// Get weather for a specific time slot
	getWeatherForTimeSlot: publicProcedure
		.input(
			z.object({
				date: z.string(),
				startHour: z.number().min(0).max(23),
				endHour: z.number().min(0).max(23),
			}),
		)
		.query(async ({ input }): Promise<TimeSlotWeather | null> => {
			const weatherData = getWeatherForDate(input.date);
			if (!weatherData) {
				return null;
			}

			const { startHour, endHour } = input;
			const duration = endHour - startHour;

			// Get temperatures for start, middle, and end of time slot
			const startTemp = weatherData.hourlyTemperatures[startHour] || 0;
			const middleHour = Math.floor(startHour + duration / 2);
			const middleTemp = weatherData.hourlyTemperatures[middleHour] || startTemp;
			const endTemp = weatherData.hourlyTemperatures[endHour] || startTemp;

			// Get the most common weather code in the time slot
			const codesInSlot = weatherData.weatherCodes.slice(startHour, endHour + 1);
			const weatherCode = getMostCommonCode(codesInSlot);

			return {
				startTemp,
				middleTemp,
				endTemp,
				weatherCode,
			};
		}),

	// Check if weather service is enabled
	isEnabled: publicProcedure.query(() => {
		return !!env.WEATHER_LOCATION;
	}),
});

// Helper function to get the most common weather code
function getMostCommonCode(codes: number[]): number {
	if (codes.length === 0) return 0;

	const counts = codes.reduce(
		(acc, code) => {
			acc[code] = (acc[code] || 0) + 1;
			return acc;
		},
		{} as Record<number, number>,
	);

	return Number.parseInt(
		Object.entries(counts).reduce((a, b) => {
			const aCount = counts[Number.parseInt(a[0])] || 0;
			const bCount = counts[Number.parseInt(b[0])] || 0;
			return aCount > bCount ? a : b;
		})[0],
	);
}
