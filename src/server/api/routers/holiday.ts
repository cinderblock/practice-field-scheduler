import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isValidDate } from "~/server/util/timeUtils";

const holidaySchema = z.object({
	name: z.string().min(1, "Holiday name is required"),
	date: z.string().refine(val => isValidDate(val), "Invalid date"),
	icon: z.string().min(1, "Icon is required"),
	url: z.string().url().optional().or(z.literal("")),
	created: z.date().optional(),
	userId: z.string().optional(),
});

export const holidayRouter = createTRPCRouter({
	add: protectedProcedure.input(holidaySchema).mutation(async ({ input, ctx }) => {
		const holiday = await ctx.context.addHoliday(input);
		return { success: true, holiday };
	}),

	remove: protectedProcedure
		.input(
			z.object({
				id: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			await ctx.context.removeHoliday(input);
			return { success: true };
		}),

	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.context.getHolidays();
	}),
});
