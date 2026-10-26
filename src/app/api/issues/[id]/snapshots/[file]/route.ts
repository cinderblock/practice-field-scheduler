import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PermissionError } from "~/server/backend";
import { contextFromRequest } from "~/server/requestContext";
import { isSnapshotFileName } from "~/server/util/fieldIssue";

/**
 * One snapshot of a field issue report, for the admin viewer. Admin-only, like the viewer:
 * these are photos of the shop and of whatever someone pointed their phone at.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
	const { id, file } = await params;
	if (!/^[0-9a-f-]{36}$/.test(id) || !isSnapshotFileName(file)) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const ctx = await contextFromRequest(request);
	if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

	try {
		const found = await ctx.readFieldIssueSnapshot(id, file);
		if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

		return new NextResponse(new Uint8Array(found.bytes), {
			status: 200,
			headers: {
				"Content-Type": found.contentType,
				"Content-Length": found.bytes.length.toString(),
				// The file never changes once written, but it's for the admin's eyes only.
				"Cache-Control": "private, max-age=86400, immutable",
				"Content-Disposition": `inline; filename="${found.snapshot.file}"`,
			},
		});
	} catch (err) {
		if (err instanceof PermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
		console.error("Error reading a field issue snapshot:", err);
		return NextResponse.json({ error: "The snapshot couldn't be read" }, { status: 500 });
	}
}
