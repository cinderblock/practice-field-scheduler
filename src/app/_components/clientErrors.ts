import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";

export type RequestError = TRPCClientErrorLike<AppRouter>;

const OutOfDatePage = "This page is out of date. Reload it and try again; nothing was changed.";

/**
 * Failed input validation comes back as Zod's issues, in JSON, which nobody
 * should have to read. A rule like a note's length has a message written for
 * people. A field that's missing or the wrong type means this page and the
 * server disagree about the request, so a deploy has passed this tab by.
 */
function describeInvalidInput(raw: string) {
	try {
		const issues = JSON.parse(raw) as { code: string; message: string }[];
		if (issues.every(issue => issue.code === "custom" || issue.code === "too_big")) {
			return issues.map(issue => issue.message).join(" ");
		}
	} catch {}
	return OutOfDatePage;
}

/**
 * What to tell someone when a request failed. An answer from the server
 * carries `data.code` and a message written for people (a refusal says what
 * was refused); anything else means the request never got an answer, which is
 * the browser's side of the story and worth reporting.
 */
export function describeRequestError(err: RequestError): { message: string; reachedServer: boolean } {
	if (err.data?.zodError) return { message: describeInvalidInput(err.message), reachedServer: true };
	if (err.data?.code) return { message: err.message, reachedServer: true };
	return {
		message: "Couldn't reach the server. Check your connection and try again; nothing was changed.",
		reachedServer: false,
	};
}
