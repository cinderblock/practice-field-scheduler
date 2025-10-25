import type { ICalCalendar, ICalEventData } from "ical-generator";
import ical from "ical-generator";
import { env } from "~/env";
import { getPublicFeedData } from "~/server/backend";
import type { Reservation } from "~/types";

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
	const _minute = Number.parseInt(mStr, 10);
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
		// Sort by date and the *actual* temporal start of each slot so that sequential
		// reservations appear next to each other even when the slot strings don't
		// sort correctly lexicographically (e.g. "10:00am" vs "9:00am").
		resList.sort((a, b) => {
			if (a.date !== b.date) return a.date.localeCompare(b.date);
			const aStart = parseSlotToDate(a.date, a.slot)?.start.getTime() ?? 0;
			const bStart = parseSlotToDate(b.date, b.slot)?.start.getTime() ?? 0;
			return aStart - bStart;
		});

		// Map to track an open group per team
		interface Group {
			start: Date;
			end: Date;
			description?: string;
		}
		const openGroups = new Map<Reservation["team"], Group>();

		const flushGroup = (teamKey: Reservation["team"], group: Group) => {
			const avatar = `${env.NEXTAUTH_URL.replace(/\/$/, "")}/api/team-avatar/${teamKey}`;
			push({
				id: `${group.start.toISOString()}-${teamKey}`,
				start: group.start,
				end: group.end,
				summary: `Team ${teamKey} Reservation`,
				description: group.description ?? "",
				x: {
					"X-image": avatar,
				},
			} as ICalEventData);
		};

		for (const r of resList) {
			if (r.abandoned) continue;
			const dateTimes = parseSlotToDate(r.date, r.slot);
			if (!dateTimes) continue;

			const teamKey = r.team;
			const current = openGroups.get(teamKey);
			if (current && dateTimes.start.getTime() === current.end.getTime()) {
				// Extend the existing contiguous block for this team
				current.end = dateTimes.end;
				if (!current.description && r.notes) current.description = r.notes;
				openGroups.set(teamKey, current);
			} else {
				// Flush previous block for this team (if any) and start a new one
				if (current) flushGroup(teamKey, current);
				openGroups.set(teamKey, {
					start: dateTimes.start,
					end: dateTimes.end,
					description: r.notes ?? undefined,
				});
			}
		}

		// Flush any groups still open
		for (const [teamKey, group] of openGroups.entries()) {
			flushGroup(teamKey, group);
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
