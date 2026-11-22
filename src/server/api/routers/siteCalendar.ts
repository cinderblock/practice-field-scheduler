import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getSiteCalendarEvents } from "~/server/siteCalendar";

export const siteCalendarRouter = createTRPCRouter({
	/** Events from the site's own calendar around the dates the calendar shows; empty when not configured */
	events: protectedProcedure.query(() => getSiteCalendarEvents()),
});
