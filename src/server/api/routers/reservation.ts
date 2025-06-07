import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { Context } from "~/server/backend";

const reservationSchema = z.object({
	date: z.string(),
	slot: z.string(), // HH:mm format local time
	team: z.string(),
	notes: z.string(),
	priority: z.boolean(),
});

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
