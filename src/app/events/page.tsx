"use server";

import Link from "next/link";
import { redirect } from "next/navigation";
import { EventSummary } from "~/app/_components/EventBreak";
import { TSLLogo } from "~/app/_components/TSLLogo";
import page from "~/app/users/users.module.css";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { getFrcEvents } from "~/server/frcEvents";
import { defaultSeason, formatDateRange, formatMonth, type ScheduleRow, seasonSchedule } from "~/server/util/frcEvents";
import styles from "../index.module.css";
import events from "./events.module.css";

function rowLabel(row: ScheduleRow): string {
	switch (row.kind) {
		case "week":
			return `Week ${row.week}`;
		case "championship":
			return "Championship";
		case "month":
			return formatMonth(row.month);
	}
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ season?: string | string[] }> }) {
	const session = await auth();
	if (!session) {
		redirect("/");
	}

	const snapshot = await getFrcEvents();
	const today = new Date().toLocaleDateString("en-CA", { timeZone: env.TIME_ZONE });

	const requested = Number((await searchParams).season);
	const seasons = snapshot?.seasons ?? [];
	const season =
		snapshot && seasons.includes(requested) ? requested : defaultSeason(snapshot ?? { events: [], seasons }, today);
	const rows = snapshot ? seasonSchedule(snapshot, season) : [];
	const ours = rows.reduce((count, row) => count + row.events.length, 0);

	return (
		<div className={page.page}>
			<div className={page.header}>
				<div className={page.logo}>
					<TSLLogo />
				</div>
				<h1 className={styles.title}>Events</h1>
			</div>

			<div className={events.intro}>
				<p>FRC events our teams are registered for.</p>
				{seasons.length > 1 && (
					<nav className={events.seasons} aria-label="Season">
						{seasons.map(s => (
							<Link
								key={s}
								href={`/events?season=${s}`}
								className={events.season}
								aria-current={s === season ? "page" : undefined}
							>
								{s}
							</Link>
						))}
					</nav>
				)}
			</div>

			{!snapshot ? (
				<p className={events.empty}>Event data hasn&apos;t loaded yet. Check back in a minute.</p>
			) : (
				<>
					{ours === 0 && <p className={events.empty}>None of our teams are registered for {season} events yet.</p>}
					<ol className={events.rows}>
						{rows.map(row => {
							const past = row.end < today;
							const current = row.start <= today && today <= row.end;
							const className = [events.row];
							if (past) className.push(events.past);
							if (current) className.push(events.current);
							if (!row.events.length) className.push(events.quiet);

							return (
								<li key={row.key} className={className.join(" ")} aria-current={current ? "date" : undefined}>
									<div className={events.when}>
										<span className={events.label}>{rowLabel(row)}</span>
										<span className={events.dates}>{formatDateRange(row.start, row.end)}</span>
									</div>
									{row.events.length ? (
										<ul className={events.list}>
											{row.events.map(event => (
												<EventSummary
													key={`${event.season}${event.code}`}
													event={event}
													className={event.end < today ? events.past : undefined}
												/>
											))}
										</ul>
									) : (
										<span className={events.none}>None of our teams</span>
									)}
								</li>
							);
						})}
					</ol>
					<p className={events.footer}>
						Updated{" "}
						{snapshot.updated.toLocaleString("en-US", {
							timeZone: env.TIME_ZONE,
							dateStyle: "medium",
							timeStyle: "short",
						})}{" "}
						from FIRST&apos;s FRC Events API.
					</p>
				</>
			)}

			<p className={events.footer}>
				<Link href="/">Back to the calendar</Link>
			</p>
		</div>
	);
}
