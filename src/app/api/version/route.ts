import { NextResponse } from "next/server";
import { buildVersion } from "~/server/buildVersion";

export const dynamic = "force-dynamic";

/** Open tabs compare this with the version they were served by. See `UpdateWatcher`. */
export function GET() {
	return NextResponse.json({ version: buildVersion() }, { headers: { "Cache-Control": "no-store" } });
}
