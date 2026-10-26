import "server-only";

import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { Context } from "~/server/backend";

/**
 * The signed-in person's backend `Context` for a route handler, or null when nobody is
 * signed in. The same session-plus-headers recipe the pages use, in one place.
 */
export async function contextFromRequest(req: NextRequest): Promise<Context | null> {
	const session = await auth();
	if (!session) return null;

	const userAgent = req.headers.get("user-agent") ?? "";
	const forwardedFor = req.headers.get("x-forwarded-for");
	const ip = (forwardedFor ? forwardedFor.split(",")[0] : req.headers.get("x-real-ip")) ?? "unknown";

	return new Context(session, userAgent, ip);
}
