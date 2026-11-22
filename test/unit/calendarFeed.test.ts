import { describe, expect, it, vi } from "vitest";
import type { Reservation } from "~/types";

vi.mock("~/env", () => ({
	env: {
		TIME_ZONE: "America/Los_Angeles",
		TIME_SLOT_BORDERS: [-2, 4, 7, 10],
		NEXTAUTH_URL: "https://field.example.test/",
	},
}));

const base = {
	date: "2026-05-23",
	created: new Date("2026-05-20T00:00:00Z"),
	userId: "user-1",
	priority: false,
} as const;

const reservations: Reservation[] = [
	{ ...base, id: "own", slot: "10:00am", team: "1234" },
	{ ...base, id: "guest", slot: "04:00pm", team: "9999", host: "1234" },
	{ ...base, id: "other", slot: "07:00pm", team: "4321" },
];

vi.mock("~/server/backend", () => ({
	getPublicFeedData: async () => ({ reservations: reservations.map(r => ({ ...r })), blackouts: [], siteEvents: [] }),
}));

const { generateICS } = await import("~/server/calendarFeed");

const summaries = (ics: string) => [...ics.matchAll(/^SUMMARY:(.*)$/gm)].map(m => m[1]?.trim());

describe("team calendar feed", () => {
	it("includes the guests a team hosts, labelled as its guests", async () => {
		expect(summaries(await generateICS({ kind: "team", team: "1234" }))).toEqual([
			"Team 1234 Reservation",
			"Team 9999 Reservation (guest of 1234)",
		]);
	});

	it("includes a guest reservation in the guest team's own feed", async () => {
		expect(summaries(await generateICS({ kind: "team", team: "9999" }))).toEqual([
			"Team 9999 Reservation (guest of 1234)",
		]);
	});

	it("keeps a guest block apart from the same team's own block next to it", async () => {
		reservations.push({ ...base, id: "own-later", slot: "07:00pm", team: "9999" });
		try {
			expect(summaries(await generateICS({ kind: "team", team: "9999" }))).toEqual([
				"Team 9999 Reservation (guest of 1234)",
				"Team 9999 Reservation",
			]);
		} finally {
			reservations.pop();
		}
	});

	it("gives an extra robot's line an event of its own", async () => {
		reservations.push(
			{ ...base, id: "second-robot", slot: "10:00am", team: "1234", extraRobot: true },
			{ ...base, id: "third-robot", slot: "10:00am", team: "1234", extraRobot: true },
		);
		try {
			const ics = await generateICS({ kind: "team", team: "1234" });
			expect(summaries(ics)).toEqual([
				"Team 1234 Reservation",
				"Team 1234 Reservation (extra robot)",
				"Team 1234 Reservation (extra robot)",
				"Team 9999 Reservation (guest of 1234)",
			]);
			const uids = [...ics.matchAll(/^UID:(.*)$/gm)].map(m => m[1]);
			expect(new Set(uids).size).toBe(uids.length);
		} finally {
			reservations.splice(-2);
		}
	});

	it("keeps each note of a block made of several reservations", async () => {
		reservations.push(
			{ ...base, id: "first", slot: "04:00pm", team: "5678", notes: "Arriving late" },
			{ ...base, id: "second", slot: "07:00pm", team: "5678", notes: "Leaving early" },
			{ ...base, id: "third", slot: "10:00pm", team: "5678", notes: "Arriving late" },
		);
		try {
			const ics = await generateICS({ kind: "team", team: "5678" });
			expect(ics).toContain("DESCRIPTION:Arriving late\\nLeaving early");
			expect(ics.match(/Arriving late/g)).toHaveLength(1);
		} finally {
			reservations.splice(-3);
		}
	});
});

describe("waitlisted lines in the feed", () => {
	it("labels a line past the slot's places as waitlisted, judged against every team in the slot", async () => {
		const full = ["1001", "1002", "1003", "1004"].map((team, i) => ({
			...base,
			id: `full-${team}`,
			slot: "10:00pm",
			team,
			created: new Date(Date.UTC(2026, 4, 20, 0, i)),
		}));
		reservations.push(...full, {
			...base,
			id: "late",
			slot: "10:00pm",
			team: "5555",
			created: new Date(Date.UTC(2026, 4, 20, 1)),
		});
		try {
			expect(summaries(await generateICS({ kind: "team", team: "5555" }))).toEqual([
				"Team 5555 Reservation (waitlisted)",
			]);
			expect(summaries(await generateICS({ kind: "team", team: "1004" }))).toEqual(["Team 1004 Reservation"]);

			// A priority line goes ahead, which pushes the newest ordinary line out
			reservations.push({ ...base, id: "prio", slot: "10:00pm", team: "7777", priority: true });
			expect(summaries(await generateICS({ kind: "team", team: "1004" }))).toEqual([
				"Team 1004 Reservation (waitlisted)",
			]);
			reservations.pop();
		} finally {
			reservations.splice(-5);
		}
	});
});
