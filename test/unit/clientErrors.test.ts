import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeRequestError, type RequestError } from "~/app/_components/clientErrors";
import { notesSchema, reservationSchema } from "~/server/api/schemas/reservation";

/** What the browser gets when a procedure's input fails `schema`. */
function rejectedBy(schema: z.ZodTypeAny, input: unknown) {
	const result = schema.safeParse(input);
	if (result.success) throw new Error("expected this input to fail");
	return {
		message: result.error.message,
		data: { code: "BAD_REQUEST", zodError: result.error.flatten() },
	} as unknown as RequestError;
}

describe("describing a failed request", () => {
	it("tells a tab that disagrees with the server about a request to reload", () => {
		const err = rejectedBy(reservationSchema, { date: "2026-11-03", slot: "07:00pm", team: "8048" });

		const { message, reachedServer } = describeRequestError(err);

		expect(message).toMatch(/out of date/);
		expect(reachedServer).toBe(true);
	});

	it("says the same for a field the server doesn't know", () => {
		const err = rejectedBy(z.object({}).strict(), { added: true });

		expect(describeRequestError(err).message).toMatch(/out of date/);
	});

	it("passes on a rule's own message", () => {
		const err = rejectedBy(notesSchema, "one\ntwo");

		expect(describeRequestError(err).message).toBe("A note must be a single line");
	});

	it("says what's wrong with a long note", () => {
		const err = rejectedBy(notesSchema, "x".repeat(500));

		expect(describeRequestError(err).message).toMatch(/at most/);
	});

	it("keeps a refusal's own words", () => {
		const err = { message: "Team 8048 already has this slot.", data: { code: "INTERNAL_SERVER_ERROR" } };

		expect(describeRequestError(err as unknown as RequestError).message).toBe("Team 8048 already has this slot.");
	});

	it("says when the server never answered", () => {
		const { reachedServer } = describeRequestError({ message: "Failed to fetch" } as unknown as RequestError);

		expect(reachedServer).toBe(false);
	});
});
