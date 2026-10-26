import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { InvalidRequestError, PermissionError } from "~/server/backend";
import { contextFromRequest } from "~/server/requestContext";
import { MAX_PHOTO_BYTES } from "~/server/util/fieldIssue";

/**
 * Attach a photo from the reporter's device to a field issue report.
 *
 * Multipart, one file per request under the field name `photo`, so each photo succeeds or
 * fails on its own and the browser can retry just the ones that didn't make it. The report
 * itself was filed over tRPC a moment earlier; tRPC carries JSON (via superjson) and is the
 * wrong shape for a few hundred KB of JPEG.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid report id" }, { status: 400 });

	const ctx = await contextFromRequest(request);
	if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

	// Refuse an oversized body before reading it, when the browser says how big it is.
	const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
	if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES + 64 * 1024) {
		return NextResponse.json({ error: `Photos must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB` }, { status: 413 });
	}

	let photo: FormDataEntryValue | null;
	try {
		photo = (await request.formData()).get("photo");
	} catch {
		return NextResponse.json({ error: "Expected a multipart form with a photo" }, { status: 400 });
	}
	if (!(photo instanceof File) || photo.size === 0) {
		return NextResponse.json({ error: "No photo in the request" }, { status: 400 });
	}

	try {
		const snapshot = await ctx.attachFieldIssuePhoto(id, Buffer.from(await photo.arrayBuffer()));
		return NextResponse.json({ snapshot });
	} catch (err) {
		if (err instanceof PermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
		if (err instanceof InvalidRequestError) return NextResponse.json({ error: err.message }, { status: err.status });
		console.error("Error attaching a field issue photo:", err);
		void ctx.recordServerError("fieldIssuePhoto", err instanceof Error ? err.message : String(err), { id });
		return NextResponse.json({ error: "The photo couldn't be saved" }, { status: 500 });
	}
}
