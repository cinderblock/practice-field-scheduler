import { getTeamAvatar } from "~/server/teamLogoManager";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ teamNumber: string }> }) {
	try {
		const { teamNumber } = await params;
		const teamNum = Number.parseInt(teamNumber, 10);

		if (Number.isNaN(teamNum) || teamNum <= 0) {
			return NextResponse.json({ error: "Invalid team number" }, { status: 400 });
		}

		const avatarBuffer = await getTeamAvatar(teamNum);

		return new NextResponse(avatarBuffer, {
			status: 200,
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=86400", // Cache for 1 day
				"Content-Length": avatarBuffer.length.toString(),
			},
		});
	} catch (error) {
		console.error(`Error fetching avatar for team ${(await params).teamNumber}:`, error);

		// Return a 404 for team not found or API errors
		return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
	}
}
