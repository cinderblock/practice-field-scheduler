"use server";

import "server-only";

import Link from "next/link";
import { headers } from "next/headers";
import { Context } from "~/server/backend";
import { ReservationCalendar } from "~/app/_components/ReservationCalendar";
import { auth } from "~/server/auth";
import { HydrateClient } from "~/trpc/server";
import styles from "./index.module.css";
import type { Session } from "next-auth";
import { dateToDateString } from "~/server/util/timeUtils";
import { RenderTime } from "./_components/RenderTime";

export default async function Home() {
	const session = await auth();

	return (
		<HydrateClient>
			<main className={styles.main}>
				<div className={styles.container}>
					<h1 className={styles.title}>Practice Field Scheduler</h1>
					{session ? <LoggedIn session={session} /> : <LoginButton />}
				</div>
			</main>
		</HydrateClient>
	);
}

async function LoggedIn({ session }: { session: Session }) {
	const headersList = await headers();
	const userAgent = headersList.get("user-agent") ?? "";
	const forwardedFor = headersList.get("x-forwarded-for");
	const ip = (forwardedFor ? forwardedFor.split(",")[0] : headersList.get("x-real-ip")) ?? "unknown";

	// Get reservations directly from server
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

	const reservationsByDate = await Promise.all(
		dates.map(async date => ({
			date,
			reservations: await ctx.listReservations(date),
		})),
	);

	console.log("Logged in - PID:", process.pid, "Reservations loaded:", reservationsByDate.length);

	return (
		<div className={styles.reservationCalendar}>
			<div className={`${styles.showcaseText} ${styles.showcaseRow}`}>
				<span>
					Logged in as {session.user?.name}
					{session.user?.image && (
						<img
							style={{ userSelect: "none" }}
							src={session.user.image}
							alt={`${session.user.name}'s profile`}
							className={styles.profileImage}
							width={48}
						/>
					)}
				</span>
				<Link style={{ userSelect: "none" }} href="/api/auth/signout" className={styles.logoutButtonSmall}>
					Sign&nbsp;out
				</Link>
			</div>
			<ReservationCalendar initialReservations={reservationsByDate} />
			<RenderTime time={new Date()} pid={process.pid} />
		</div>
	);
}

function LoginButton() {
	return (
		<>
			<h2>Please log in to view the reservation calendar.</h2>
			<Link href="/api/auth/signin" className={styles.loginButton}>
				Sign&nbsp;in
			</Link>
		</>
	);
}
