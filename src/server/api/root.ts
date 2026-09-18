import { accessRouter } from "~/server/api/routers/access";
import { blackoutRouter } from "~/server/api/routers/blackout";
import { errorsRouter } from "~/server/api/routers/errors";
import { holidayRouter } from "~/server/api/routers/holiday";
import { reservationRouter } from "~/server/api/routers/reservation";
import { slackRouter } from "~/server/api/routers/slack";
import { weatherRouter } from "~/server/api/routers/weather";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
	reservation: reservationRouter,
	holiday: holidayRouter,
	slack: slackRouter,
	access: accessRouter,
	blackout: blackoutRouter,
	weather: weatherRouter,
	errors: errorsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
