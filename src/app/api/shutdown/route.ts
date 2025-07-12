import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { env } from "~/env";

if (env.STAGING) {
	const minutes = 60;

	const endStr = `${minutes} minutes - PID: ${process.pid}`;

	console.log(`🟢 Staging mode enabled. Shutting down in ${endStr}`);

	setTimeout(
		() => {
			console.log(`🔴 Shutting down staging server after ${endStr}`);
			process.exit(0);
		},
		minutes * 60 * 1000,
	).unref();
}

export async function GET() {
	// Only allow shutdown in staging environment
	if (!env.STAGING) notFound();

	console.log("🔴 Shutdown request received via API endpoint");

	// Send response first
	const response = NextResponse.json({ message: "Shutting down server..." });

	// Shutdown immediately after response is sent
	setTimeout(() => {
		console.log("🔴 Shutting down staging server via API request");
		process.exit(0);
	}, 10);

	return response;
}

export async function POST() {
	return GET(); // Support both GET and POST
}
