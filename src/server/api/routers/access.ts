import { z } from "zod";
import { describeSiteHours } from "~/server/access";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { slackNameSyncState } from "~/server/backend";
import { gateAccessUrl } from "~/server/notifications";
import { isSlackConfigured } from "~/server/slack";

/**
 * Team identifier. FRC teams are numbers; house/special teams are strings
 * (see `TeamFull`). Accept either and let the backend normalize.
 */
const teamInput = z.union([z.number().int().positive(), z.string().min(1).max(64)]);
const userInput = z.string().min(1).max(64);

/**
 * Gate-link management: admins for everyone, `mine` for a person's own links.
 * Listings never include tokens — revealing a link is an explicit, audited
 * action.
 */
export const accessRouter = createTRPCRouter({
	/** Configuration facts the admin UI uses to explain what will and won't work. */
	config: protectedProcedure.query(async ({ ctx }) => {
		await ctx.context.assertAdmin("Only admins can view access configuration");
		return {
			slackConfigured: isSlackConfigured(),
			gateUrlConfigured: gateAccessUrl("probe") !== null,
			siteHours: describeSiteHours(),
			/** Whether Slack names can be read; gate links wait on them. */
			slackNames: slackNameSyncState(),
		};
	}),

	/** A person's own links. Any team member can replace their team's link. */
	mine: createTRPCRouter({
		list: protectedProcedure.query(async ({ ctx }) => {
			const links = await ctx.context.getMyGateLinks();
			return {
				...links,
				teams: links.teams.map(t => ({ ...t, team: String(t.team) })),
				gateUrlConfigured: gateAccessUrl("probe") !== null,
				slackConfigured: isSlackConfigured(),
				siteHours: describeSiteHours(),
			};
		}),

		revealTeam: protectedProcedure.input(z.object({ team: teamInput })).mutation(async ({ input, ctx }) => {
			const { team, token } = await ctx.context.revealMyTeamLink(input.team);
			return { team: String(team), url: gateAccessUrl(token), token };
		}),

		rotateTeam: protectedProcedure.input(z.object({ team: teamInput })).mutation(async ({ input, ctx }) => {
			const result = await ctx.context.rotateMyTeamLink(input.team);
			return { ...result, team: String(result.team) };
		}),

		revealPersonal: protectedProcedure.mutation(async ({ ctx }) => {
			const { token } = await ctx.context.revealMyPersonalLink();
			return { url: gateAccessUrl(token), token };
		}),

		rotatePersonal: protectedProcedure.mutation(({ ctx }) => ctx.context.rotateMyPersonalLink()),
	}),

	teams: createTRPCRouter({
		list: protectedProcedure.query(async ({ ctx }) => {
			const entries = await ctx.context.listTeamAccess();
			return entries.map(e => ({ ...e, team: String(e.team) }));
		}),

		reveal: protectedProcedure.input(z.object({ team: teamInput })).mutation(async ({ input, ctx }) => {
			const { team, token } = await ctx.context.revealTeamAccessLink(input.team);
			return { team: String(team), url: gateAccessUrl(token), token };
		}),

		/** Every existing bookmark for the team stops working; the team is DM'd the new link. */
		rotate: protectedProcedure.input(z.object({ team: teamInput })).mutation(async ({ input, ctx }) => {
			const result = await ctx.context.rotateTeamAccessLink(input.team);
			return { ...result, team: String(result.team) };
		}),
	}),

	personal: createTRPCRouter({
		/** Status per user ID. */
		list: protectedProcedure.query(({ ctx }) => ctx.context.listPersonalAccess()),

		reveal: protectedProcedure.input(z.object({ userId: userInput })).mutation(async ({ input, ctx }) => {
			const { userId, token } = await ctx.context.revealPersonalAccessLink(input.userId);
			return { userId, url: gateAccessUrl(token), token };
		}),

		/** The person's old link stops working; they're DM'd the new one. */
		rotate: protectedProcedure
			.input(z.object({ userId: userInput }))
			.mutation(({ input, ctx }) => ctx.context.rotatePersonalAccessLink(input.userId)),

		/**
		 * Approve someone for general gate access (issues and DMs their personal
		 * link), or revoke it (deletes the link).
		 */
		setApproved: protectedProcedure
			.input(z.object({ userId: userInput, approved: z.boolean() }))
			.mutation(({ input, ctx }) => ctx.context.setGeneralAccessApproved(input.userId, input.approved)),
	}),
});
