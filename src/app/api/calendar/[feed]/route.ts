import { headers } from "next/headers";
import { generateICS } from "~/server/calendarFeed";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { feed: string } }) {
	let feedParam = params.feed;
	// Remove .ics suffix if present
	if (feedParam.endsWith(".ics")) {
		feedParam = feedParam.slice(0, -4);
	}
	let kind: "all" | "site" | "team";
	let team: string | undefined;
	if (feedParam === "all") kind = "all";
	else if (feedParam === "site") kind = "site";
	else {
		kind = "team";
		team = feedParam;
	}

	const hdrs = await headers();
	const forwarded = hdrs.get("x-forwarded-for");
	const ip = (forwarded ? forwarded.split(",")[0] : hdrs.get("x-real-ip")) ?? "unknown";
	console.log(`Calendar feed request: ${kind}${team ? ` ${team}` : ""} -`, ip);

	const ics = await generateICS({ kind, team });
	const filename = `${feedParam}.ics`;
	return new Response(ics, {
		status: 200,
		headers: {
			"Content-Type": "text/calendar; charset=utf-8",
			"Content-Disposition": `inline; filename=${filename}`,
			"Cache-Control": "public, max-age=300",
		},
	});
}
