import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getTeamAvatar } from "~/server/teamLogoManager";

export async function GET(request: NextRequest, { params }: { params: Promise<{ teamNumber: string }> }) {
	const { teamNumber } = await params;
	const teamNum = Number.parseInt(teamNumber, 10);

	if (Number.isNaN(teamNum) || teamNum <= 0 || teamNum > 100_000) {
		return NextResponse.json({ error: "Invalid team number" }, { status: 400 });
	}

	const avatarBuffer = await getTeamAvatar(teamNum);

	if (!avatarBuffer) {
		return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
	}

	return new NextResponse(avatarBuffer, {
		status: 200,
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=86400", // Cache for 1 day
			"Content-Length": avatarBuffer.length.toString(),
		},
	});
}
