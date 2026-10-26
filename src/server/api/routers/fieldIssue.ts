import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { FIELD_ISSUE_KIND_IDS, FIELD_ISSUE_NOTES_MAX, fieldIssueKindInfo } from "~/server/util/fieldIssue";
import { isValidDate, isValidTime } from "~/server/util/timeUtils";

/*
 * Field issue reports. Filing one is open to anyone signed in; reading, resolving and
 * removing them is admin-only (enforced in the backend). Device photos don't come through
 * here: they're multipart uploads to /api/issues/[id]/photos.
 */

const addSchema = z
	.object({
		kind: z.enum(FIELD_ISSUE_KIND_IDS),
		date: z.string().refine(val => isValidDate(val), "Invalid date"),
		slot: z.string().refine(val => isValidTime(val), "Invalid time slot"),
		team: z
			.string()
			.trim()
			.max(20, "Team is too long")
			.refine(val => !val || /^\d+$/.test(val), "Team must be a team number")
			.optional(),
		notes: z.string().trim().max(FIELD_ISSUE_NOTES_MAX, "Notes are too long").optional(),
		captureCameras: z.boolean().optional(),
	})
	.refine(({ kind, notes }) => !fieldIssueKindInfo(kind).notesRequired || !!notes, {
		message: "Say what happened: this kind of report needs a note",
		path: ["notes"],
	});

export const fieldIssueRouter = createTRPCRouter({
	add: protectedProcedure.input(addSchema).mutation(async ({ input, ctx }) => {
		const { issue, cameras } = await ctx.context.addFieldIssue(input);
		return { success: true, issue, cameras };
	}),

	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.context.listFieldIssues();
	}),

	setResolved: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				resolved: z.boolean(),
				resolution: z.string().trim().max(FIELD_ISSUE_NOTES_MAX, "The note is too long").optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const issue = await ctx.context.setFieldIssueResolved(input);
			return { success: true, issue };
		}),

	remove: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input, ctx }) => {
		const issue = await ctx.context.removeFieldIssue(input);
		return { success: true, issue };
	}),
});
