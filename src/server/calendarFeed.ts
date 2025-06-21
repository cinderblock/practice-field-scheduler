import { getPublicFeedData } from "~/server/backend";
import ical from "ical-generator";
import type { ICalCalendar, ICalEventData } from "ical-generator";
import type { Reservation } from "~/types";
import { env } from "~/env";

export type FeedKind = "all" | "site" | "team";

interface GenerateOptions {
	kind: FeedKind;
	/** Required if kind === "team" */
	team?: string;
}

function parseSlotToDate(date: string, slot: string): { start: Date; end: Date } | null {
	const match = slot.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
	if (!match) return null;
	const hStr = match[1] as string;
	const mStr = match[2] as string;
	const rawAmPm = match[3] as string;
	const minute = Number.parseInt(mStr, 10);
	let hour = Number.parseInt(hStr, 10);
	const ampm = rawAmPm.toLowerCase();
	if (ampm === "pm" && hour !== 12) hour += 12;
	if (ampm === "am" && hour === 12) hour = 0;

	const start = new Date(`${date}T${hour.toString().padStart(2, "0")}:${mStr}:00`);

	// Determine end based on NEXT_PUBLIC_TIME_SLOT_BORDERS
	const borders = env.NEXT_PUBLIC_TIME_SLOT_BORDERS.map(b => b + 12); // convert to 24-hour absolute hours
	const idx = borders.indexOf(hour);
	let end: Date;
	if (idx !== -1 && idx < borders.length - 1) {
		const nextHour = borders[idx + 1];
		if (nextHour !== undefined) {
			end = new Date(`${date}T${nextHour.toString().padStart(2, "0")}:${mStr}:00`);
		} else {
			end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
		}
	} else {
		// Fallback: 3-hour block
		end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
	}
	return { start, end };
}

export async function generateICS({ kind, team }: GenerateOptions): Promise<string> {
	if (kind === "team" && !team) throw new Error("team number required for team feed");

	const { reservations, blackouts, siteEvents } = await getPublicFeedData();

	const tz = env.NEXT_PUBLIC_TIME_ZONE;

	const prefix = process.env.NODE_ENV !== "production" ? "DEV " : "";
	const cal: ICalCalendar = ical({
		name:
			prefix +
			(kind === "all" ? "All Field Events" : kind === "site" ? "Field Site/Blackouts" : `Team ${team} Reservations`),
		timezone: tz,
		prodId: {
			company: "practice-field-scheduler",
			product: "field-calendar",
			language: "EN",
		},
	});

	// Helper for pushing event data
	const push = (event: ICalEventData) => {
		cal.createEvent(event);
	};

	// Add reservations
	if (kind === "all" || (kind === "team" && team)) {
		const resList = kind === "all" ? reservations : reservations.filter(r => (r.team as string).toString() === team);
		// Sort by date & slot for grouping
		resList.sort((a, b) => {
			if (a.date !== b.date) return a.date.localeCompare(b.date);
			return a.slot.localeCompare(b.slot);
		});

		let groupStart: ReturnType<typeof parseSlotToDate> | null = null;
		let currentTeam: Reservation["team"] | null = null;
		for (const r of resList) {
			if (r.abandoned) continue;
			const dateTimes = parseSlotToDate(r.date, r.slot);
			if (!dateTimes) continue;

			if (groupStart && currentTeam === r.team && dateTimes.start.getTime() === (groupStart.end?.getTime() ?? 0)) {
				// Extend current group
				groupStart.end = dateTimes.end;
			} else {
				// Flush previous group
				if (groupStart) {
					const avatar = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/team-avatar/${currentTeam}`;
					push({
						id: `${groupStart.start.toISOString()}-${currentTeam}`,
						start: groupStart.start,
						end: groupStart.end,
						summary: `Team ${currentTeam} Reservation`,
						description: r?.notes ?? "",
						x: {
							"X-image": avatar,
						},
					} as ICalEventData);
				}
				// Start new group
				groupStart = { ...dateTimes };
				currentTeam = r.team;
			}
		}
		// Flush last group
		if (groupStart) {
			const avatar = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/team-avatar/${currentTeam}`;
			push({
				id: `${groupStart.start.toISOString()}-${currentTeam}`,
				start: groupStart.start,
				end: groupStart.end,
				summary: `Team ${currentTeam} Reservation`,
				x: {
					"X-image": avatar,
				},
			} as ICalEventData);
		}
	}

	// Add blackouts to all & site feeds
	if (kind === "all" || kind === "site") {
		for (const b of blackouts) {
			if (b.deleted) continue;
			const dateTimes = parseSlotToDate(b.date, b.slot);
			if (!dateTimes) continue;
			push({
				id: `blackout-${b.date}-${b.slot}`,
				start: dateTimes.start,
				end: dateTimes.end,
				summary: "Field Blackout",
				description: b.reason ?? undefined,
			});
		}
	}

	// Add site events to all & site & team feeds
	if (kind === "all" || kind === "site" || kind === "team") {
		for (const e of siteEvents) {
			if (e.deleted) continue;
			const start = new Date(`${e.date}T00:00:00`);
			const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
			push({
				id: `site-${e.date}`,
				start,
				end,
				allDay: true,
				summary: e.notes ? `Site: ${e.notes}` : "Site Event",
			});
		}
	}

	return cal.toString();
}
