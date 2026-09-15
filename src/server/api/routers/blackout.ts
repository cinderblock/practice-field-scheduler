import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isValidDate, isValidTime } from "~/server/util/timeUtils";

const dateSchema = z.string().refine(val => isValidDate(val), "Invalid date");

const blackoutSchema = z
	.object({
		date: dateSchema,
		// Omitted for a single-day blackout
		endDate: dateSchema.optional(),
		// Omitted to black out the whole day
		slot: z
			.string()
			.refine(val => isValidTime(val), "Invalid time slot")
			.optional(),
		reason: z.string().max(200, "Reason is too long").optional(),
	})
	.refine(({ date, endDate }) => endDate === undefined || endDate >= date, {
		message: "End date must not be before the start date",
		path: ["endDate"],
	});

export const blackoutRouter = createTRPCRouter({
	add: protectedProcedure.input(blackoutSchema).mutation(async ({ input, ctx }) => {
		const { blackout, conflicts } = await ctx.context.addBlackout(input);
		return { success: true, blackout, conflicts };
	}),

	remove: protectedProcedure
		.input(
			z.object({
				id: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const blackout = await ctx.context.removeBlackout(input);
			return { success: true, blackout };
		}),

	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.context.getBlackouts();
	}),
});
