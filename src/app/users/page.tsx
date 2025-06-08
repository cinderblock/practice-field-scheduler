"use server";

import { auth } from "~/server/auth";
import { Context } from "~/server/backend";
import { headers } from "next/headers";
import { UsersTable } from "./_components/UsersTable";
import type { UserEntry } from "~/types";
import { redirect } from "next/navigation";
import { TSLLogo } from "~/app/_components/TSLLogo";
import styles from "../index.module.css";

export default async function UsersPage() {
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

	// Get all users but filter sensitive data for non-admins
	const users = (await ctx.getUsers()).map((user: UserEntry) => ({
		id: user.id,
		name: user.name,
		image: user.image,
		created: user.created,
		teams: isAdmin ? user.teams : [],
		isAdmin: user.teams === "admin",
	}));

	return (
		<div style={{ width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
			<div
				style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}
			>
				<div style={{ maxWidth: "100px", width: "100%" }}>
					<TSLLogo />
				</div>
				<h1 className={styles.title}>Users</h1>
			</div>
			<UsersTable users={users} isAdmin={isAdmin} />
		</div>
	);
}
