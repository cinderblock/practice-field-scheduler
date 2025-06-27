import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { TSLLogo } from "~/app/_components/TSLLogo";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { Context } from "~/server/backend";
import styles from "../index.module.css";
import { LogsTable } from "./_components/LogsTable";

export default async function LogsPage() {
	const session = await auth();
	if (!session) {
		return redirect("/");
	}

	const headersList = await headers();
	const userAgent = headersList.get("user-agent") ?? "";
	const forwardedFor = headersList.get("x-forwarded-for");
	const ip = (forwardedFor ? forwardedFor.split(",")[0] : headersList.get("x-real-ip")) ?? "unknown";

	const ctx = new Context(session, userAgent, ip);
	const isAdmin = (await ctx.getTeams()) === "admin";

	if (!isAdmin) {
		return notFound();
	}

	// Read logs from file
	const YEAR = new Date().getFullYear().toString();
	const LOGS_FILE = resolve(env.DATA_DIR, YEAR, "logs.txt");

	let logs = [];
	try {
		const logContent = await readFile(LOGS_FILE, "utf-8");
		const users = await ctx.getUsers();

		logs = logContent
			.split("\n")
			.filter(Boolean)
			.map(line => {
				const log = JSON.parse(line);
				// Add user name to each log entry
				const user = users.find(u => u.id === log.userId);
				return {
					...log,
					userName: user?.name ?? "Unknown User",
				};
			})
			.reverse(); // Most recent first
	} catch (err) {
		console.error("Error reading logs:", err);
	}

	return (
		<div style={{ width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
			<div
				style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}
			>
				<div style={{ maxWidth: "100px", width: "100%" }}>
					<TSLLogo />
				</div>
				<h1 className={styles.title}>Logs</h1>
			</div>
			<LogsTable logs={logs} />
		</div>
	);
}
