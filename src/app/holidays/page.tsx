"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TSLLogo } from "~/app/_components/TSLLogo";
import { auth } from "~/server/auth";
import { Context } from "~/server/backend";
import styles from "../index.module.css";
import { HolidaysTable } from "./_components/HolidaysTable";

export default async function HolidaysPage() {
	const session = await auth();
	if (!session) {
		redirect("/");
	}

	const headersList = await headers();
	const userAgent = headersList.get("user-agent") ?? "";
	const forwardedFor = headersList.get("x-forwarded-for");
	const ip = (forwardedFor ? forwardedFor.split(",")[0] : headersList.get("x-real-ip")) ?? "unknown";

	const ctx = new Context(session, userAgent, ip);
	const isAdmin = (await ctx.getTeams()) === "admin";

	if (!isAdmin) {
		redirect("/");
	}

	// Get all holidays
	const holidays = await ctx.getHolidays();

	return (
		<div style={{ width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
			<div
				style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}
			>
				<div style={{ maxWidth: "100px", width: "100%" }}>
					<TSLLogo />
				</div>
				<h1 className={styles.title}>Holidays</h1>
			</div>
			<HolidaysTable holidays={holidays} />
		</div>
	);
}
