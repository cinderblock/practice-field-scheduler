import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isValidDate, isValidTime } from "~/server/util/timeUtils";

export const weatherRouter = createTRPCRouter({
	getWeatherForTimeSlot: protectedProcedure
		.input(
			z.object({
				date: z.string().refine(val => isValidDate(val), "Invalid date"),
				slot: z.string().refine(val => isValidTime(val), "Invalid time"),
			}),
		)
		.query(async ({ input, ctx }) => {
			return ctx.context.getWeatherForTimeSlot(input.date, input.slot);
		}),

	getWeatherCache: protectedProcedure.query(async ({ ctx }) => {
		return ctx.context.getWeatherCache();
	}),

	isWeatherEnabled: protectedProcedure.query(async ({ ctx }) => {
		return ctx.context.isWeatherEnabled();
	}),
});
