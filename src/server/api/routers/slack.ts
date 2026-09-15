import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isSlackConfigured, SlackApiError, SlackNotConfiguredError, sendDirectMessage } from "~/server/slack";
import { pickNameForValidation } from "~/server/util/slackName";

const NAME_FIX_MESSAGE = [
	"Hi! The practice-field scheduler now expects Slack display names in the format:",
	"",
	"    `First Last (1234)`",
	"",
	"where `1234` is your FRC team number. If you're on multiple teams, list them comma-separated, e.g. `First Last (1234, 5678)`.",
	"",
	"Please update your Slack display name (Profile → Edit profile → Display name) so the scheduler can verify your team membership. Once your name matches, future logins will work normally.",
].join("\n");

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
	 * Admin-only audit: returns users whose Slack display name doesn't
	 * match the expected "First Last (1234)" convention. Does not send
	 * anything; safe to call any time.
	 */
	listUsersWithInvalidNames: protectedProcedure.query(async ({ ctx }) => {
		const entries = await ctx.context.listUsersWithInvalidSlackName();
		return entries.map(({ user, slackIds }) => ({
			userId: user.id,
			name: user.name,
			displayName: user.displayName ?? null,
			currentName: pickNameForValidation(user),
			slackIds,
		}));
	}),

	/**
	 * Admin-only: DM every user whose Slack display name doesn't match
	 * the expected convention, asking them to update it. Best-effort —
	 * per-user failures are reported in the result instead of aborting
	 * the whole batch.
	 *
	 * Optionally accepts `dryRun: true` to skip sending and just report
	 * who would be nudged.
	 */
	nudgeUsersWithInvalidNames: protectedProcedure
		.input(z.object({ dryRun: z.boolean().default(false) }).default({}))
		.mutation(async ({ input, ctx }) => {
			await ctx.context.assertAdmin("Only admins can nudge users");

			if (!input.dryRun && !isSlackConfigured()) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Slack bot token is not configured on the server (SLACK_BOT_TOKEN unset)",
				});
			}

			const entries = await ctx.context.listUsersWithInvalidSlackName();
			type Outcome = {
				userId: string;
				slackId: string;
				ok: boolean;
				error?: string;
			};
			const outcomes: Outcome[] = [];

			for (const { user, slackIds } of entries) {
				if (slackIds.length === 0) {
					outcomes.push({
						userId: user.id,
						slackId: "",
						ok: false,
						error: "no Slack ID on record",
					});
					continue;
				}
				for (const slackId of slackIds) {
					if (input.dryRun) {
						outcomes.push({ userId: user.id, slackId, ok: true });
						continue;
					}
					try {
						await sendDirectMessage({ slackUserId: slackId, text: NAME_FIX_MESSAGE });
						outcomes.push({ userId: user.id, slackId, ok: true });
					} catch (err) {
						const message = err instanceof SlackApiError ? err.slackError : (err as Error).message;
						outcomes.push({ userId: user.id, slackId, ok: false, error: message });
					}
				}
			}

			return {
				dryRun: input.dryRun,
				total: outcomes.length,
				succeeded: outcomes.filter(o => o.ok).length,
				failed: outcomes.filter(o => !o.ok).length,
				outcomes,
			};
		}),
});
