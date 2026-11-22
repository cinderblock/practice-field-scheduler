import { describe, expect, it } from "vitest";
import { type EventLister, fetchEventsSnapshot, seasonsToFetch } from "~/server/frcEvents";
import {
	defaultSeason,
	describeEventLead,
	eventLeadFor,
	eventLinks,
	eventsByTeam,
	formatDateRange,
	mergeRegistrations,
	parseEventListing,
	placeEventBreaks,
	seasonSchedule,
	seasonWeeks,
} from "~/server/util/frcEvents";
import type { FrcEvent, FrcEventsSnapshot } from "~/types";

/** A record shaped like FIRST's `/{season}/events` */
function apiEvent(code: string, dateStart: string, dateEnd: string, extra: Record<string, unknown> = {}) {
	return {
		allianceCount: "EightAlliance",
		weekNumber: 1,
		announcements: [],
		code,
		divisionCode: null,
		name: `${code} Regional`,
		type: "Regional",
		districtCode: null,
		venue: "Some Arena",
		city: "San Jose",
		stateprov: "CA",
		country: "USA",
		dateStart: `${dateStart}T00:00:00`,
		dateEnd: `${dateEnd}T23:59:59`,
		address: "1 Main St",
		website: null,
		webcasts: [],
		timezone: "Pacific Standard Time",
		...extra,
	};
}

function event(code: string, start: string, end: string, teams: number[], extra: Partial<FrcEvent> = {}): FrcEvent {
	return {
		season: 2027,
		code,
		name: `${code} Regional`,
		type: "Regional",
		week: 1,
		start,
		end,
		venue: "",
		city: "San Jose",
		stateProv: "CA",
		country: "USA",
		teams,
		...extra,
	};
}

/** Consecutive dates from `start` */
function days(start: string, count: number) {
	return Array.from({ length: count }, (_, i) => {
		const d = new Date(`${start}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + i);
		return d.toISOString().slice(0, 10);
	});
}

describe("parseEventListing", () => {
	it("keeps the event's own dates and normalizes the fields", () => {
		const [parsed] = parseEventListing({ Events: [apiEvent("casj", "2027-03-04", "2027-03-07")], eventCount: 1 }, 2027);

		expect(parsed).toEqual({
			season: 2027,
			code: "CASJ",
			name: "casj Regional",
			type: "Regional",
			week: 1,
			start: "2027-03-04",
			end: "2027-03-07",
			venue: "Some Arena",
			city: "San Jose",
			stateProv: "CA",
			country: "USA",
		});
	});

	it("drops records that don't fit rather than failing the lot", () => {
		const events = parseEventListing({ Events: [{ code: "BAD" }, apiEvent("CASJ", "2027-03-04", "2027-03-07")] }, 2027);
		expect(events.map(e => e.code)).toEqual(["CASJ"]);
	});

	it("only gives competition events a week", () => {
		const events = parseEventListing(
			{
				Events: [
					apiEvent("OFF", "2026-10-10", "2026-10-11", { type: "OffSeason", weekNumber: 0 }),
					apiEvent("CMPTX", "2027-04-14", "2027-04-17", { type: "Championship", weekNumber: 7 }),
					apiEvent("CASJ", "2027-03-04", "2027-03-07", { weekNumber: 2 }),
				],
			},
			2027,
		);
		expect(events.map(e => [e.code, e.week])).toEqual([
			["OFF", null],
			["CMPTX", null],
			["CASJ", 2],
		]);
	});

	it("rejects a body that isn't an event listing", () => {
		expect(() => parseEventListing({ nope: true }, 2027)).toThrow("Unexpected event listing");
	});
});

describe("mergeRegistrations", () => {
	it("lists each event once with every team going, in date order", () => {
		const [a, b] = parseEventListing(
			{ Events: [apiEvent("LATE", "2027-03-20", "2027-03-22"), apiEvent("EARLY", "2027-03-04", "2027-03-06")] },
			2027,
		);
		if (!a || !b) throw new Error("fixture");

		const merged = mergeRegistrations([
			[649, [a, b]],
			[8, [a]],
		]);

		expect(merged.map(e => [e.code, e.teams])).toEqual([
			["EARLY", [649]],
			["LATE", [8, 649]],
		]);
	});
});

describe("seasonWeeks", () => {
	it("spans each week from its earliest start to its latest end", () => {
		const events = parseEventListing(
			{
				Events: [
					apiEvent("A", "2027-03-04", "2027-03-07", { weekNumber: 1 }),
					apiEvent("B", "2027-03-05", "2027-03-08", { weekNumber: 1 }),
					apiEvent("C", "2027-03-11", "2027-03-14", { weekNumber: 2 }),
					apiEvent("OFF", "2027-07-10", "2027-07-11", { type: "OffSeason" }),
				],
			},
			2027,
		);

		expect(seasonWeeks(2027, events)).toEqual([
			{ season: 2027, week: 1, start: "2027-03-04", end: "2027-03-08" },
			{ season: 2027, week: 2, start: "2027-03-11", end: "2027-03-14" },
		]);
	});
});

describe("eventLinks", () => {
	it("keys events as season and lowercase code", () => {
		expect(eventLinks({ season: 2027, code: "CASJ" })).toEqual({
			tba: "https://www.thebluealliance.com/event/2027casj",
			statbotics: "https://www.statbotics.io/event/2027casj",
		});
	});
});

describe("placeEventBreaks", () => {
	// 2027-03-01 is a Monday
	const week = days("2027-03-01", 9);

	it("goes before a Friday start, between Thursday and Friday", () => {
		const breaks = placeEventBreaks(week, [event("A", "2027-03-05", "2027-03-07", [8])]);
		expect([...breaks.keys()]).toEqual(["2027-03-05"]);
	});

	it("follows the event when it starts earlier", () => {
		const breaks = placeEventBreaks(week, [event("A", "2027-03-03", "2027-03-06", [8])]);
		expect([...breaks.keys()]).toEqual(["2027-03-03"]);
	});

	it("puts overlapping events under one break, before the earliest", () => {
		const a = event("A", "2027-03-04", "2027-03-06", [8]);
		const b = event("B", "2027-03-05", "2027-03-07", [649]);
		const breaks = placeEventBreaks(week, [b, a]);
		expect([...breaks.entries()]).toEqual([["2027-03-04", [a, b]]]);
	});

	it("keeps separate weekends separate", () => {
		const a = event("A", "2027-03-05", "2027-03-07", [8]);
		const b = event("B", "2027-03-08", "2027-03-09", [649]);
		expect([...placeEventBreaks(week, [a, b]).keys()]).toEqual(["2027-03-05", "2027-03-08"]);
	});

	it("puts an event already under way before the first day shown", () => {
		const breaks = placeEventBreaks(days("2027-03-06", 8), [event("A", "2027-03-04", "2027-03-07", [8])]);
		expect([...breaks.keys()]).toEqual(["2027-03-06"]);
	});

	it("leaves out events outside the days shown", () => {
		const breaks = placeEventBreaks(week, [
			event("PAST", "2027-02-25", "2027-02-28", [8]),
			event("LATER", "2027-03-12", "2027-03-14", [8]),
		]);
		expect(breaks.size).toBe(0);
	});

	it("handles no days", () => {
		expect(placeEventBreaks([], [event("A", "2027-03-05", "2027-03-07", [8])]).size).toBe(0);
	});
});

describe("defaultSeason", () => {
	it("opens on the earliest season with our events still to come", () => {
		const snapshot = {
			seasons: [2026, 2027],
			events: [
				event("DONE", "2026-03-05", "2026-03-07", [8], { season: 2026 }),
				event("NEXT", "2027-03-05", "2027-03-07", [8]),
			],
		};
		expect(defaultSeason(snapshot, "2026-11-21")).toBe(2027);
		expect(defaultSeason(snapshot, "2026-03-06")).toBe(2026);
	});

	it("falls back to this year, or the latest published season", () => {
		expect(defaultSeason({ seasons: [2026, 2027], events: [] }, "2026-11-21")).toBe(2026);
		expect(defaultSeason({ seasons: [2027], events: [] }, "2026-11-21")).toBe(2027);
		expect(defaultSeason({ seasons: [], events: [] }, "2026-11-21")).toBe(2026);
	});
});

describe("seasonSchedule", () => {
	it("lays out every week, the Championship, and off-season months in date order", () => {
		const snapshot: Pick<FrcEventsSnapshot, "events" | "weeks"> = {
			weeks: [
				{ season: 2027, week: 1, start: "2027-02-25", end: "2027-03-01" },
				{ season: 2027, week: 2, start: "2027-03-04", end: "2027-03-08" },
				{ season: 2026, week: 1, start: "2026-02-26", end: "2026-03-02" },
			],
			events: [
				event("W2", "2027-03-05", "2027-03-07", [8], { week: 2 }),
				event("CMP", "2027-04-14", "2027-04-17", [8], { type: "ChampionshipDivision", week: null }),
				event("OFF", "2027-01-16", "2027-01-16", [8], { type: "OffSeason", week: null }),
				event("OTHER", "2026-03-05", "2026-03-07", [8], { season: 2026 }),
			],
		};

		const rows = seasonSchedule(snapshot, 2027);
		expect(rows.map(row => [row.key, row.events.map(e => e.code)])).toEqual([
			["month-2027-01", ["OFF"]],
			["week-1", []],
			["week-2", ["W2"]],
			["championship", ["CMP"]],
		]);
	});
});

describe("eventsByTeam", () => {
	it("finds each team's events in a date range", () => {
		const a = event("A", "2027-03-05", "2027-03-07", [8, 649]);
		const b = event("B", "2027-03-19", "2027-03-21", [8]);
		const byTeam = eventsByTeam([b, a], "2027-03-01", "2027-03-14");
		expect(byTeam).toEqual(
			new Map([
				[8, [a]],
				[649, [a]],
			]),
		);
	});
});

describe("eventLeadFor", () => {
	const svr = event("SVR", "2027-03-11", "2027-03-13", [8, 649]);
	const later = event("LATER", "2027-03-14", "2027-03-16", [8]);

	it("covers the week before an event through its last day", () => {
		expect(eventLeadFor([svr], 8, "2027-03-03")).toBeUndefined();
		expect(eventLeadFor([svr], 8, "2027-03-04")).toEqual({ event: svr, daysBefore: 7 });
		expect(eventLeadFor([svr], 8, "2027-03-11")).toEqual({ event: svr, daysBefore: 0 });
		expect(eventLeadFor([svr], 8, "2027-03-13")).toEqual({ event: svr, daysBefore: -2 });
		expect(eventLeadFor([svr], 8, "2027-03-14")).toBeUndefined();
	});

	it("only flags teams registered for the event", () => {
		expect(eventLeadFor([svr], 254, "2027-03-08")).toBeUndefined();
		expect(eventLeadFor([svr], "649", "2027-03-08")).toEqual({ event: svr, daysBefore: 3 });
		expect(eventLeadFor([svr], "house", "2027-03-08")).toBeUndefined();
	});

	it("picks the earliest of several events", () => {
		expect(eventLeadFor([later, svr], 8, "2027-03-09")?.event).toBe(svr);
		// The first is over, so the next one counts
		expect(eventLeadFor([later, svr], 8, "2027-03-14")).toEqual({ event: later, daysBefore: 0 });
	});
});

describe("describeEventLead", () => {
	const svr = event("SVR", "2027-03-11", "2027-03-13", [8]);
	it("counts down to the event, then says it is on", () => {
		expect(describeEventLead({ event: svr, daysBefore: 3 })).toBe("3 days before SVR Regional");
		expect(describeEventLead({ event: svr, daysBefore: 1 })).toBe("Day before SVR Regional");
		expect(describeEventLead({ event: svr, daysBefore: 0 })).toBe("First day of SVR Regional");
		expect(describeEventLead({ event: svr, daysBefore: -1 })).toBe("During SVR Regional");
	});
});

describe("formatDateRange", () => {
	it("is short within a month and spells out both months across one", () => {
		expect(formatDateRange("2027-03-04", "2027-03-07")).toBe("Mar 4 – 7");
		expect(formatDateRange("2027-02-26", "2027-03-01")).toBe("Feb 26 – Mar 1");
		expect(formatDateRange("2027-03-04", "2027-03-04")).toBe("Mar 4");
		expect(formatDateRange("2027-03-05", "2027-03-07", { weekday: true })).toBe("Fri, Mar 5 – Sun, Mar 7");
	});
});

describe("seasonsToFetch", () => {
	it("is this year's season and the next", () => {
		expect(seasonsToFetch(new Date(2026, 10, 21))).toEqual([2026, 2027]);
	});
});

////// Fetching //////

function httpError(status: number) {
	return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

type Listings = Record<string, unknown | Error>;

/** Answers from a table keyed `season` or `season:team`; anything missing is an empty listing */
function fakeLister(listings: Listings) {
	const calls: string[] = [];
	const list: EventLister = async (season, team) => {
		const key = team === undefined ? `${season}` : `${season}:${team}`;
		calls.push(key);
		const answer = listings[key] ?? { Events: [] };
		if (answer instanceof Error) throw answer;
		return answer;
	};
	return { list, calls };
}

const noWait = async () => {};
const fixedNow = () => new Date("2026-11-21T12:00:00Z");

describe("fetchEventsSnapshot", () => {
	const season2027 = {
		Events: [
			apiEvent("CASJ", "2027-03-04", "2027-03-07", { weekNumber: 1 }),
			apiEvent("CADA", "2027-03-11", "2027-03-14", { weekNumber: 2 }),
		],
	};

	it("asks for every event once per season, then each team's", async () => {
		const { list, calls } = fakeLister({
			"2027": season2027,
			"2027:8": { Events: [apiEvent("CASJ", "2027-03-04", "2027-03-07", { weekNumber: 1 })] },
			"2027:649": {
				Events: [
					apiEvent("CASJ", "2027-03-04", "2027-03-07", { weekNumber: 1 }),
					apiEvent("CADA", "2027-03-11", "2027-03-14", { weekNumber: 2 }),
				],
			},
		});

		let waits = 0;
		const { snapshot, problems } = await fetchEventsSnapshot({
			teams: [8, 649],
			seasons: [2027],
			listEvents: list,
			rateLimit: async () => {
				waits++;
			},
			now: fixedNow,
		});

		expect(calls).toEqual(["2027", "2027:8", "2027:649"]);
		expect(waits).toBe(calls.length);
		expect(problems).toEqual([]);
		expect(snapshot.seasons).toEqual([2027]);
		expect(snapshot.weeks.map(w => w.week)).toEqual([1, 2]);
		expect(snapshot.events.map(e => [e.code, e.teams])).toEqual([
			["CASJ", [8, 649]],
			["CADA", [649]],
		]);
		expect(snapshot.updated).toEqual(fixedNow());
	});

	it("skips a season FIRST hasn't published, without asking about teams", async () => {
		const { list, calls } = fakeLister({ "2026": season2027, "2027": httpError(404) });
		const { snapshot, problems } = await fetchEventsSnapshot({
			teams: [8],
			seasons: [2026, 2027],
			listEvents: list,
			rateLimit: noWait,
		});

		expect(calls).toEqual(["2026", "2026:8", "2027"]);
		expect(snapshot.seasons).toEqual([2026]);
		expect(problems).toEqual([]);
	});

	it("skips a season with nothing scheduled yet", async () => {
		const { list, calls } = fakeLister({});
		const { snapshot } = await fetchEventsSnapshot({
			teams: [8],
			seasons: [2027],
			listEvents: list,
			rateLimit: noWait,
		});
		expect(calls).toEqual(["2027"]);
		expect(snapshot.seasons).toEqual([]);
	});

	it("treats a team FIRST doesn't know this season as having no events", async () => {
		const { list } = fakeLister({ "2027": season2027, "2027:9999": httpError(400) });
		const { snapshot, problems } = await fetchEventsSnapshot({
			teams: [9999],
			seasons: [2027],
			listEvents: list,
			rateLimit: noWait,
		});
		expect(snapshot.events).toEqual([]);
		expect(problems).toEqual([]);
	});

	it("keeps a team's previous events when its request fails", async () => {
		const previous: FrcEventsSnapshot = {
			updated: new Date("2026-11-20T12:00:00Z"),
			seasons: [2027],
			weeks: [],
			events: [event("CASJ", "2027-03-04", "2027-03-07", [8, 649]), event("CADA", "2027-03-11", "2027-03-14", [649])],
		};
		const { list } = fakeLister({
			"2027": season2027,
			"2027:8": { Events: [] },
			"2027:649": httpError(500),
		});

		const { snapshot, problems } = await fetchEventsSnapshot({
			teams: [8, 649],
			seasons: [2027],
			previous,
			listEvents: list,
			rateLimit: noWait,
		});

		expect(snapshot.events.map(e => [e.code, e.teams])).toEqual([
			["CASJ", [649]],
			["CADA", [649]],
		]);
		expect(problems).toEqual(["2027 events for team 649: HTTP 500"]);
	});

	it("keeps a season's previous data when FIRST fails on it", async () => {
		const previous: FrcEventsSnapshot = {
			updated: new Date("2026-11-20T12:00:00Z"),
			seasons: [2026, 2027],
			weeks: [{ season: 2027, week: 1, start: "2027-03-04", end: "2027-03-07" }],
			events: [event("CASJ", "2027-03-04", "2027-03-07", [8])],
		};
		const { list } = fakeLister({ "2026": season2027, "2027": httpError(503) });

		const { snapshot, problems } = await fetchEventsSnapshot({
			teams: [],
			seasons: [2026, 2027],
			previous,
			listEvents: list,
			rateLimit: noWait,
		});

		expect(snapshot.seasons).toEqual([2026, 2027]);
		expect(snapshot.weeks.filter(w => w.season === 2027)).toEqual(previous.weeks);
		expect(snapshot.events.map(e => e.code)).toEqual(["CASJ"]);
		expect(problems).toEqual(["2027 events: HTTP 503"]);
	});

	it("throws when FIRST refuses the credentials, rather than reporting no events", async () => {
		const { list } = fakeLister({ "2026": httpError(401), "2027": httpError(401) });
		await expect(
			fetchEventsSnapshot({ teams: [8], seasons: [2026, 2027], listEvents: list, rateLimit: noWait }),
		).rejects.toThrow("401");
	});

	it("keeps a team's previous events when FIRST rate limits it", async () => {
		const previous: FrcEventsSnapshot = {
			updated: new Date("2026-11-20T12:00:00Z"),
			seasons: [2027],
			weeks: [],
			events: [event("CASJ", "2027-03-04", "2027-03-07", [8])],
		};
		const { list } = fakeLister({ "2027": season2027, "2027:8": httpError(429) });
		const { snapshot, problems } = await fetchEventsSnapshot({
			teams: [8],
			seasons: [2027],
			previous,
			listEvents: list,
			rateLimit: noWait,
		});
		expect(snapshot.events.map(e => [e.code, e.teams])).toEqual([["CASJ", [8]]]);
		expect(problems).toEqual(["2027 events for team 8: HTTP 429"]);
	});

	it("throws when FIRST can't be reached at all", async () => {
		const { list } = fakeLister({
			"2026": new Error("getaddrinfo ENOTFOUND"),
			"2027": new Error("getaddrinfo ENOTFOUND"),
		});
		await expect(
			fetchEventsSnapshot({ teams: [8], seasons: [2026, 2027], listEvents: list, rateLimit: noWait }),
		).rejects.toThrow("ENOTFOUND");
	});
});
