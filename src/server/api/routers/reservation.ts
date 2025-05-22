import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { Context } from "~/server/backend";

const reservationSchema = z.object({
  date: z.string(),
  slot: z.string(), // HH:mm format
  team: z.union([z.number(), z.string()]),
  notes: z.string(),
  priority: z.boolean(),
});

export const reservationRouter = createTRPCRouter({
  add: publicProcedure
    .input(reservationSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.session) throw new Error("Not authenticated");
      const backendCtx = new Context(ctx.session, ctx.userAgent, ctx.ip);
      await backendCtx.addReservation(input);
      return { success: true };
    }),

  remove: publicProcedure
    .input(reservationSchema.extend({ reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.session) throw new Error("Not authenticated");
      const backendCtx = new Context(ctx.session, ctx.userAgent, ctx.ip);
      await backendCtx.removeReservation(input);
      return { success: true };
    }),

  list: publicProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.session) throw new Error("Not authenticated");
      const backendCtx = new Context(ctx.session, ctx.userAgent, ctx.ip);
      return backendCtx.listReservations(input.date);
    }),
}); 