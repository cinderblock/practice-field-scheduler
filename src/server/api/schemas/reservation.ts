import { z } from "zod";
import { isValidTeamNumber, RESERVATION_NOTES_MAX } from "~/server/util/reservation";
import { isValidDate, isValidTime, isValidTimeSlot } from "~/server/util/timeUtils";

const teamSchema = z.string().refine(isValidTeamNumber, "A team number must be a positive whole number");

export const notesSchema = z
	.string()
	.trim()
	.max(RESERVATION_NOTES_MAX, `A note can be at most ${RESERVATION_NOTES_MAX} characters`)
	.refine(val => !/[\r\n]/.test(val), "A note must be a single line");

export const reservationSchema = z
	.object({
		date: z.string().refine(val => isValidDate(val), "Invalid date"),
		slot: z.string().refine(val => isValidTime(val), "Invalid time"),
		team: teamSchema,
		/** Set for a guest reservation: the booker's team, which hosts `team`. */
		host: teamSchema.optional(),
		notes: notesSchema,
		/** Defaulted, not required: a tab opened before a deploy keeps running the old client, which doesn't send it. */
		extraRobot: z.boolean().default(false),
		priority: z.boolean(),
	})
	.refine(({ date, slot }) => isValidTimeSlot(`${date} ${slot}`), "Invalid time slot");
