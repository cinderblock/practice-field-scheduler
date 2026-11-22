import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getFrcEvents } from "~/server/frcEvents";

export const frcEventsRouter = createTRPCRouter({
	/** Our teams' FRC events this season and next, or null until they have been fetched */
	list: protectedProcedure.query(() => getFrcEvents()),
});
