import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * Browsers report what went wrong for them here; the backend files it with
 * who and where in the season's `errors.txt`, for review later. See
 * `recordError` in the backend.
 */
export const errorsRouter = createTRPCRouter({
	report: protectedProcedure
		.input(
			z.object({
				kind: z.string().min(1).max(40),
				message: z.string().min(1).max(2000),
				detail: z.string().max(8000).optional(),
				page: z.string().max(500).optional(),
			}),
		)
		.mutation(({ input, ctx }) => ctx.context.reportClientError(input)),
});
