import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isValidDate, isValidTime, isValidTimeSlot } from "~/server/util/timeUtils";

const reservationSchema = z
	.object({
		date: z.string().refine(val => isValidDate(val), "Invalid date"),
		slot: z.string().refine(val => isValidTime(val), "Invalid time"),
		team: z.string().refine(val => !val.includes("\n") && /^\d+/.test(val), "Invalid team reservation"),
		notes: z.string(),
		priority: z.boolean(),
	})
	.refine(({ date, slot }) => isValidTimeSlot(`${date} ${slot}`), "Invalid time slot");

export const reservationRouter = createTRPCRouter({
	add: protectedProcedure.input(reservationSchema).mutation(async ({ input, ctx }) => {
		console.log("Add reservation mutation - PID:", process.pid);
		const reservation = await ctx.context.addReservation(input);
		return { success: true, reservation };
	}),

	remove: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				reason: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			console.log("Remove reservation - PID:", process.pid);
			const reservation = await ctx.context.removeReservation(input);
			return { success: true, reservation };
		}),

	list: protectedProcedure.input(z.object({ date: z.string() })).query(async ({ input, ctx }) => {
		return ctx.context.listReservations(input.date);
	}),
});
