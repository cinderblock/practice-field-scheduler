import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";

export type RequestError = TRPCClientErrorLike<AppRouter>;

/**
 * What to tell someone when a request failed. An answer from the server
 * carries `data.code` and a message written for people (a refusal says what
 * was refused); anything else means the request never got an answer, which is
 * the browser's side of the story and worth reporting.
 */
export function describeRequestError(err: RequestError): { message: string; reachedServer: boolean } {
	if (err.data?.code) return { message: err.message, reachedServer: true };
	return {
		message: "Couldn't reach the server. Check your connection and try again; nothing was changed.",
		reachedServer: false,
	};
}
