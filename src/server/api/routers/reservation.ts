import { z } from "zod";
import { notesSchema, reservationSchema } from "~/server/api/schemas/reservation";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isValidDate } from "~/server/util/timeUtils";

export const reservationRouter = createTRPCRouter({
	add: protectedProcedure.input(reservationSchema).mutation(async ({ input, ctx }) => {
		console.log("Add reservation mutation - PID:", process.pid);
		const reservation = await ctx.context.addReservation(input);
		return { success: true, reservation };
	}),

	setNotes: protectedProcedure
		.input(z.object({ id: z.string(), notes: notesSchema }))
		.mutation(async ({ input, ctx }) => {
			const reservation = await ctx.context.setReservationNotes(input);
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

	/** Where a team stands against the weekly limits (#10) in the week of `date`, for the Add dialog. */
	weeklyUsage: protectedProcedure
		.input(z.object({ team: z.string(), date: z.string().refine(isValidDate, "Invalid date") }))
		.query(({ input, ctx }) => ctx.context.getWeeklyUsage(input)),

	/** Which teams the current person may book for (and host guests as), for the Add dialog. */
	bookableTeams: protectedProcedure.query(({ ctx }) => ctx.context.getBookableTeams()),
});
