import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isSlackConfigured, SlackApiError, SlackNotConfiguredError, sendDirectMessage } from "~/server/slack";

function mapSlackError(err: unknown): TRPCError {
	if (err instanceof SlackNotConfiguredError) {
		return new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Slack bot token is not configured on the server (SLACK_BOT_TOKEN unset)",
		});
	}
	if (err instanceof SlackApiError) {
		return new TRPCError({
			code: "BAD_GATEWAY",
			message: `Slack rejected the message: ${err.slackError}`,
		});
	}
	return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unexpected Slack error" });
}

export const slackRouter = createTRPCRouter({
	/**
	 * Returns whether the bot token is configured. Useful for hiding admin
	 * UI buttons that would otherwise just error.
	 */
	isConfigured: protectedProcedure.query(() => isSlackConfigured()),

	/**
	 * Send a test direct message to the *current user*. Admin-only — this
	 * is just for verifying SLACK_BOT_TOKEN and bot scopes are wired up;
	 * not user-facing functionality.
	 */
	sendTestDmToMyself: protectedProcedure
		.input(z.object({ text: z.string().min(1).max(2000) }))
		.mutation(async ({ input, ctx }) => {
			await ctx.context.assertAdmin("Only admins can send test DMs");
			const slackUserId = ctx.context.getSlackUserId();
			try {
				const result = await sendDirectMessage({ slackUserId, text: input.text });
				return { success: true as const, channel: result.channel, ts: result.ts };
			} catch (err) {
				if (err instanceof SlackNotConfiguredError || err instanceof SlackApiError) {
					throw mapSlackError(err);
				}
				throw err;
			}
		}),

	/**
	 * Admin-only: everyone in the Slack workspace whose names need fixing, from
	 * the last sync (every 10 minutes), and how that sync went.
	 */
	nameReport: protectedProcedure.query(({ ctx }) => ctx.context.getSlackNameReport()),

	/** Admin-only: re-read everyone's names from Slack now. */
	checkNamesNow: protectedProcedure.mutation(({ ctx }) => ctx.context.checkSlackNamesNow()),

	/**
	 * Admin-only: DM everyone in the report what to fix, personalised with
	 * their current names and suggested ones. `dryRun` only counts. Per-person
	 * failures are reported in the result instead of aborting the batch.
	 */
	nudgeNameProblems: protectedProcedure
		.input(z.object({ dryRun: z.boolean().default(false) }).default({}))
		.mutation(({ input, ctx }) => ctx.context.nudgeSlackNameProblems(input.dryRun)),
});
