import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { PermissionError, recordError } from "~/server/backend";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
	return createTRPCContext({
		headers: req.headers,
		userAgent: req.headers.get("user-agent") ?? "unknown",
		referrer: req.referrer,
	});
};

const handler = (req: NextRequest) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),
		onError: ({ path, error, ctx }) => {
			if (env.NODE_ENV === "development") {
				console.error(`❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`);
			}
			// Refusals record themselves, with what was refused (see Context.refuse).
			// Everything else lands in errors.txt too, with who and where when known.
			if (error.cause instanceof PermissionError) return;
			const detail = {
				path,
				code: error.code,
				stack: error.cause instanceof Error ? error.cause.stack : error.stack,
			};
			if (ctx && "context" in ctx) {
				void ctx.context.recordServerError("trpc", error.message, detail);
			} else {
				void recordError({
					source: "server",
					kind: "trpc",
					message: error.message,
					detail,
					userAgent: req.headers.get("user-agent") ?? undefined,
					ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined,
				});
			}
		},
	});

export { handler as GET, handler as POST };
