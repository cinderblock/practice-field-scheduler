"use server";

import "server-only";

import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import type { Session } from "next-auth";
import { ReservationCalendar } from "~/app/_components/ReservationCalendar";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { Context } from "~/server/backend";
import { dateToDateString } from "~/server/util/timeUtils";
import { HydrateClient } from "~/trpc/server";
import CalendarFeedButtons from "./_components/CalendarFeedButtons";
import { RenderTime } from "./_components/RenderTime";
import { ShutdownButton } from "./_components/ShutdownButton";
import { Title } from "./_components/Title";
import { TSLLogo } from "./_components/TSLLogo";
import styles from "./index.module.css";

export default async function Home() {
	const session = await auth();

	return (
		<HydrateClient>
			<main className={styles.main}>
				<GithubCorner />
				{env.STAGING && <ShutdownButton />}
				<div className={styles.container}>
					<div style={{ maxWidth: session ? "100px" : "600px", width: "100%" }}>
						<TSLLogo />
					</div>
					<Title />
					{session ? <LoggedIn session={session} /> : <LoginButton />}
					{!env.STAGING ? null : (
						<div
							style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "center", marginBottom: "1rem" }}
						>
							<span>{env.STAGING}</span>
						</div>
					)}
				</div>
			</main>
		</HydrateClient>
	);
}

function GithubCorner() {
	return (
		<a
			href="https://github.com/cinderblock/practice-field-scheduler"
			className={styles.githubCorner}
			aria-label="View source on GitHub"
		>
			<span
				style={{
					position: "absolute",
					width: "1px",
					height: "1px",
					padding: "0",
					margin: "-1px",
					overflow: "hidden",
					clip: "rect(0, 0, 0, 0)",
					whiteSpace: "nowrap",
					border: "0",
				}}
			>
				View source on GitHub
			</span>
			<svg
				width="80"
				height="80"
				viewBox="0 0 250 250"
				style={{ fill: "#151513", color: "#fff", position: "absolute", top: 0, border: 0, right: 0 }}
				aria-hidden="true"
			>
				<path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z" />
				<path
					d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2"
					fill="currentColor"
					style={{ transformOrigin: "130px 106px" }}
					// cSpell:ignore octo
					className={styles.octoArm}
				/>
				<path
					d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z"
					fill="currentColor"
					className={styles.octoBody}
				/>
			</svg>
		</a>
	);
}

async function LoggedIn({ session }: { session: Session }) {
	const headersList = await headers();
	const userAgent = headersList.get("user-agent") ?? "";
	const forwardedFor = headersList.get("x-forwarded-for");
	const ip = (forwardedFor ? forwardedFor.split(",")[0] : headersList.get("x-real-ip")) ?? "unknown";

	const today = new Date();
	const before = 1;
	const after = 8;

	// List of dates to grab data from the backend for SSR
	const dates = Array.from({ length: after + before }, (_, i) => {
		const date = new Date(today);
		date.setDate(today.getDate() + i - before);
		return dateToDateString(date);
	});

	const ctx = new Context(session, userAgent, ip);
	const userTeams = await ctx.getTeams();
	const isAdmin = userTeams === "admin";

	const reservationsByDate = await Promise.all(
		dates.map(async date => ({
			date,
			reservations: await ctx.listReservations(date),
		})),
	);

	// Get holidays for the calendar
	const holidays = await ctx.getHolidays();

	return (
		<div className={styles.reservationCalendar}>
			<div className={`${styles.showcaseText} ${styles.showcaseRow}`}>
				<span>
					Logged in as {session.user?.displayName ?? session.user?.name}
					{session.user?.image && (
						<Image
							style={{ userSelect: "none" }}
							src={session.user.image}
							alt={`${session.user.displayName ?? session.user.name}'s profile`}
							className={styles.profileImage}
							width={48}
							height={48}
							title={session.user.displayName && session.user.name ? session.user.name : undefined}
						/>
					)}
				</span>
				<div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
					{isAdmin && (
						<>
							<Link href="/logs" className={styles.logoutButtonSmall}>
								View&nbsp;Logs
							</Link>
							<Link href="/users" className={styles.logoutButtonSmall}>
								Users
							</Link>
							<Link href="/holidays" className={styles.logoutButtonSmall}>
								Holidays
							</Link>
						</>
					)}
					<Link style={{ userSelect: "none" }} href="/api/auth/signout" className={styles.logoutButtonSmall}>
						Sign&nbsp;out
					</Link>
				</div>
			</div>
			<ReservationCalendar initialReservations={reservationsByDate} initialHolidays={holidays} />
			<CalendarFeedButtons teams={Array.isArray(userTeams) ? userTeams : []} />
			<RenderTime time={new Date()} />
		</div>
	);
}

function LoginButton() {
	return (
		<>
			<h2>Please log in to view the reservation calendar.</h2>
			<Link href="/login" className={styles.loginButton}>
				Log&nbsp;in
			</Link>
		</>
	);
}
