import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { gateAccessUrl } from "~/server/notifications";
import { isSlackConfigured } from "~/server/slack";

/**
 * Team identifier. FRC teams are numbers; house/special teams are strings
 * (see `TeamFull`). Accept either and let the backend normalize.
 */
const teamInput = z.union([z.number().int().positive(), z.string().min(1).max(64)]);

export const teamAccessRouter = createTRPCRouter({
	/**
	 * Admin-only: one row per team, with link status but NOT the token —
	 * revealing a shared secret is an explicit, audited action.
	 */
	list: protectedProcedure.query(async ({ ctx }) => {
		const entries = await ctx.context.listTeamAccess();
		return {
			// Surfaced so the UI can explain why "Rotate" won't notify anyone.
			slackConfigured: isSlackConfigured(),
			gateUrlConfigured: gateAccessUrl("probe") !== null,
			teams: entries.map(e => ({
				team: String(e.team),
				hasLink: e.hasLink,
				created: e.created,
				rotated: e.rotated,
				stale: e.stale,
				memberCount: e.memberCount,
			})),
		};
	}),

	/**
	 * Admin-only: reveal one team's actual link, for handing over when Slack
	 * isn't reaching someone. Audited.
	 */
	reveal: protectedProcedure.input(z.object({ team: teamInput })).mutation(async ({ input, ctx }) => {
		const { team, token } = await ctx.context.revealTeamAccessLink(input.team);
		return { team: String(team), token, url: gateAccessUrl(token) };
	}),

	/**
	 * Admin-only: rotate a team's link. Every existing bookmark for that team
	 * stops working immediately, so the team is DM'd the new link.
	 */
	rotate: protectedProcedure.input(z.object({ team: teamInput })).mutation(async ({ input, ctx }) => {
		const result = await ctx.context.rotateTeamAccessLink(input.team);
		return { team: String(result.team), notified: result.notified, failed: result.failed };
	}),
});
