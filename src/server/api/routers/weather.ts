import { z } from "zod";
import { env } from "~/env";
import { getWeatherService } from "~/server/weatherService";
import type { TimeSlotWeather } from "~/types";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const weatherRouter = createTRPCRouter({
	getWeatherForecast: protectedProcedure.query(async ({ ctx }) => {
		const weatherData = await ctx.context.getWeatherData();
		return weatherData;
	}),

	getTimeSlotWeather: protectedProcedure
		.input(
			z.object({
				date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
				slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)), // HH:mm format
			}),
		)
		.query(async ({ input }) => {
			if (!env.WEATHER_LOCATION) {
				return [];
			}

			const weatherService = getWeatherService();
			const weatherData = weatherService.getWeatherData();

			if (!weatherData || !weatherData.forecasts.length) {
				return [];
			}

			const forecast = weatherData.forecasts[0];
			if (!forecast) {
				throw new Error("No forecast data available");
			}
			const targetDate = new Date(input.date);

			// Get time slot borders from environment
			const timeSlotBorders = env.NEXT_PUBLIC_TIME_SLOT_BORDERS;

			const timeSlotWeather: TimeSlotWeather[] = [];

			for (const slot of input.slots) {
				// Parse time slot (e.g., "10:00" -> 10)
				const [hourStr] = slot.split(":");
				if (!hourStr) continue;

				const slotHour = Number.parseInt(hourStr, 10);

				// Find the corresponding time slot border (convert from 24h to relative hour)
				const relativeHour = slotHour - 12;
				const slotIndex = timeSlotBorders.indexOf(relativeHour);
				if (slotIndex === -1) continue;

				// Calculate start, middle, and end hours for this time slot
				const startHourValue = timeSlotBorders[slotIndex];
				if (startHourValue === undefined) continue;

				const startHour = startHourValue + 12;
				const nextSlotValue = timeSlotBorders[slotIndex + 1];
				const endHour = nextSlotValue !== undefined ? nextSlotValue + 12 : startHour + 3;
				const middleHour = startHour + (endHour - startHour) / 2;

				// Get weather conditions for start, middle, and end
				const startCondition = weatherService.getWeatherForTimeSlot(targetDate, startHour);
				const middleCondition = weatherService.getWeatherForTimeSlot(targetDate, middleHour);
				const endCondition = weatherService.getWeatherForTimeSlot(targetDate, endHour);

				// Check if this slot shares temperature with the previous slot
				const prevSlotWeather = timeSlotWeather[timeSlotWeather.length - 1];
				const shareStartTemp =
					prevSlotWeather &&
					prevSlotWeather.endTemp !== undefined &&
					Math.abs(prevSlotWeather.endTemp - (startCondition?.temperature || 0)) < 0.5;

				const slotWeather: TimeSlotWeather = {
					slot,
					date: input.date,
					startTemp: shareStartTemp ? undefined : startCondition?.temperature,
					middleTemp: middleCondition?.temperature,
					endTemp: endCondition?.temperature,
					weatherCode: middleCondition?.weatherCode, // Use middle condition as representative
					precipitationProbability: Math.max(
						startCondition?.precipitationProbability || 0,
						middleCondition?.precipitationProbability || 0,
						endCondition?.precipitationProbability || 0,
					),
					windSpeed: middleCondition?.windSpeed,
				};

				timeSlotWeather.push(slotWeather);
			}

			return timeSlotWeather;
		}),
});
