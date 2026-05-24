import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "~/env";
import { checkAccess } from "~/server/backend";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
	token: z.string().min(1).max(512),
	tool: z.string().min(1).max(64),
});

function timingSafeEqualStrings(a: string, b: string): boolean {
	const aBuf = Buffer.from(a);
	const bBuf = Buffer.from(b);
	if (aBuf.length !== bBuf.length) return false;
	return crypto.timingSafeEqual(aBuf, bBuf);
}

function authorize(req: NextRequest, expected: string): boolean {
	const header = req.headers.get("authorization") ?? "";
	const match = header.match(/^Bearer\s+(.+)$/i);
	if (!match) return false;
	const provided = (match[1] as string).trim();
	if (!provided) return false;
	return timingSafeEqualStrings(provided, expected);
}

export async function POST(req: NextRequest) {
	const apiKey = env.SCHEDULER_API_KEY;
	if (!apiKey) {
		return NextResponse.json({ error: "Access API is not configured (SCHEDULER_API_KEY unset)" }, { status: 503 });
	}

	if (!authorize(req, apiKey)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let rawBody: unknown;
	try {
		rawBody = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	const parsed = requestSchema.safeParse(rawBody);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
	}

	const { token, tool } = parsed.data;

	try {
		const result = await checkAccess(token, tool);
		return NextResponse.json(result, { status: 200 });
	} catch (err) {
		console.error("Access check failed:", err);
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}
