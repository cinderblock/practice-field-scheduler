import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getWeatherForecast } from "~/server/weather";

export const weatherRouter = createTRPCRouter({
	/** Hourly forecast around reservation hours, or null when weather is disabled or unavailable */
	forecast: protectedProcedure.query(() => getWeatherForecast()),
});
