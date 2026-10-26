"use server";

import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TSLLogo } from "~/app/_components/TSLLogo";
import { auth } from "~/server/auth";
import { Context } from "~/server/backend";
import { camerasConfigured } from "~/server/cameras";
import styles from "../index.module.css";
import { IssuesList } from "./_components/IssuesList";

/** The incident log: every field issue report, with its pictures. Admin-only, like /logs. */
export default async function IssuesPage() {
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
		notFound();
	}

	const [issues, users] = await Promise.all([ctx.listFieldIssues(), ctx.getUsers()]);

	// Reports name people by id; the list shows names.
	const people: Record<string, string> = {};
	for (const user of users) people[user.id] = user.displayName || user.name;

	return (
		<div style={{ width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
			<div
				style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}
			>
				<div style={{ maxWidth: "100px", width: "100%" }}>
					<TSLLogo />
				</div>
				<h1 className={styles.title}>Field Issues</h1>
				<Link href="/" className={styles.logoutButtonSmall}>
					Back&nbsp;to&nbsp;calendar
				</Link>
			</div>
			<IssuesList issues={issues} people={people} camerasConfigured={camerasConfigured()} />
		</div>
	);
}
