import { describe, expect, it, vi } from "vitest";
import { fetchSiteCalendar, SiteCalendarError } from "~/server/siteCalendar";
import { parseSiteCalendar } from "~/server/util/siteCalendar";

const TimeZone = "America/Los_Angeles";

/** Shaped like a Google Calendar secret iCal export: CRLF lines, a VTIMEZONE, mostly UTC times */
function calendar(...events: string[][]): string {
	return [
		"BEGIN:VCALENDAR",
		"PRODID:-//Google Inc//Google Calendar 70.9054//EN",
		"VERSION:2.0",
		"CALSCALE:GREGORIAN",
		"X-WR-TIMEZONE:America/Los_Angeles",
		"BEGIN:VTIMEZONE",
		"TZID:America/Los_Angeles",
		"BEGIN:DAYLIGHT",
		"TZOFFSETFROM:-0800",
		"TZOFFSETTO:-0700",
		"TZNAME:PDT",
		"DTSTART:19700308T020000",
		"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
		"END:DAYLIGHT",
		"BEGIN:STANDARD",
		"TZOFFSETFROM:-0700",
		"TZOFFSETTO:-0800",
		"TZNAME:PST",
		"DTSTART:19701101T020000",
		"RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
		"END:STANDARD",
		"END:VTIMEZONE",
		...events.flatMap(lines => ["BEGIN:VEVENT", ...lines, "END:VEVENT"]),
		"END:VCALENDAR",
		"",
	].join("\r\n");
}

// Daylight saving time ends on 2026-11-01 in Los Angeles
const Window = { from: new Date("2026-10-25T00:00:00Z"), until: new Date("2026-11-15T00:00:00Z"), timeZone: TimeZone };

describe("parseSiteCalendar", () => {
	it("reads a one-off timed event, in UTC, onto the site's date", () => {
		const events = parseSiteCalendar(
			calendar([
				"UID:open-house@google.com",
				"DTSTART:20261108T010000Z",
				"DTEND:20261108T030000Z",
				"SUMMARY:Open house",
			]),
			Window,
		);

		expect(events).toEqual([
			{
				id: "open-house@google.com",
				title: "Open house",
				allDay: false,
				start: Date.parse("2026-11-08T01:00:00Z"),
				end: Date.parse("2026-11-08T03:00:00Z"),
				// 5pm-7pm on the 7th in Los Angeles, though it's the 8th in UTC
				dates: ["2026-11-07"],
			},
		]);
	});

	it("lists an all-day event on every day it covers, with DTEND exclusive", () => {
		const [event] = parseSiteCalendar(
			calendar([
				"UID:tournament@google.com",
				"DTSTART;VALUE=DATE:20261112",
				"DTEND;VALUE=DATE:20261115",
				"SUMMARY:Off-season tournament",
			]),
			Window,
		);

		expect(event).toMatchObject({
			allDay: true,
			dates: ["2026-11-12", "2026-11-13", "2026-11-14"],
			start: Date.parse("2026-11-12T08:00:00Z"),
			end: Date.parse("2026-11-15T08:00:00Z"),
		});
	});

	it("expands a weekly series across the DST change, skipping EXDATEs and cancellations and moving edits", () => {
		const series = [
			"UID:build-night@google.com",
			"DTSTART;TZID=America/Los_Angeles:20261001T180000",
			"DTEND;TZID=America/Los_Angeles:20261001T200000",
			"RRULE:FREQ=WEEKLY;BYDAY=TH",
			// Not on the 12th of November
			"EXDATE;TZID=America/Los_Angeles:20261112T180000",
			"SUMMARY:Build night",
		];
		const moved = [
			"UID:build-night@google.com",
			"RECURRENCE-ID;TZID=America/Los_Angeles:20261105T180000",
			"DTSTART;TZID=America/Los_Angeles:20261106T190000",
			"DTEND;TZID=America/Los_Angeles:20261106T210000",
			"SUMMARY:Build night (Friday this week)",
		];
		const cancelled = [
			"UID:build-night@google.com",
			"RECURRENCE-ID;TZID=America/Los_Angeles:20261029T180000",
			"DTSTART;TZID=America/Los_Angeles:20261029T180000",
			"DTEND;TZID=America/Los_Angeles:20261029T200000",
			"STATUS:CANCELLED",
			"SUMMARY:Build night",
		];

		const events = parseSiteCalendar(calendar(series, moved, cancelled), {
			...Window,
			until: new Date("2026-11-21T00:00:00Z"),
		});

		expect(events.map(e => ({ title: e.title, start: new Date(e.start).toISOString(), dates: e.dates }))).toEqual([
			// 29 Oct cancelled; 5 Nov moved to Friday, now in PST (UTC-8)
			{ title: "Build night (Friday this week)", start: "2026-11-07T03:00:00.000Z", dates: ["2026-11-06"] },
			// 12 Nov excluded
			{ title: "Build night", start: "2026-11-20T02:00:00.000Z", dates: ["2026-11-19"] },
		]);
		// Each occurrence has its own id
		expect(new Set(events.map(e => e.id)).size).toBe(events.length);
	});

	it("keeps the series' occurrences in daylight time before the change", () => {
		const events = parseSiteCalendar(
			calendar([
				"UID:weekly@google.com",
				"DTSTART;TZID=America/Los_Angeles:20261001T180000",
				"DTEND;TZID=America/Los_Angeles:20261001T200000",
				"RRULE:FREQ=WEEKLY;COUNT=6",
				"SUMMARY:Weekly",
			]),
			Window,
		);

		// 29 Oct (PDT, UTC-7) and 5 Nov (PST, UTC-8); the series ends there
		expect(events.map(e => new Date(e.start).toISOString())).toEqual([
			"2026-10-30T01:00:00.000Z",
			"2026-11-06T02:00:00.000Z",
		]);
	});

	it("reads a TZID the feed doesn't define as a wall clock time in that zone", () => {
		const [event] = parseSiteCalendar(
			calendar([
				"UID:ny@example.com",
				"DTSTART;TZID=America/New_York:20261110T090000",
				"DTEND;TZID=America/New_York:20261110T100000",
				"SUMMARY:Call with the east coast",
			]),
			Window,
		);

		expect(new Date(event?.start ?? 0).toISOString()).toBe("2026-11-10T14:00:00.000Z");
	});

	it("leaves out events outside the window and cancelled one-offs", () => {
		const events = parseSiteCalendar(
			calendar(
				["UID:a", "DTSTART:20261001T180000Z", "DTEND:20261001T190000Z", "SUMMARY:Too early"],
				["UID:b", "DTSTART:20261201T180000Z", "DTEND:20261201T190000Z", "SUMMARY:Too late"],
				["UID:c", "DTSTART:20261110T180000Z", "DTEND:20261110T190000Z", "STATUS:CANCELLED", "SUMMARY:Off"],
			),
			Window,
		);

		expect(events).toEqual([]);
	});

	it("treats an event ending at midnight as not touching the next day", () => {
		const [event] = parseSiteCalendar(
			calendar([
				"UID:late@google.com",
				"DTSTART;TZID=America/Los_Angeles:20261110T200000",
				"DTEND;TZID=America/Los_Angeles:20261111T000000",
				"SUMMARY:Late",
			]),
			Window,
		);

		expect(event?.dates).toEqual(["2026-11-10"]);
	});

	it("rejects text that isn't iCalendar", () => {
		expect(() => parseSiteCalendar("<html>Sign in</html>", Window)).toThrow();
	});
});

describe("fetchSiteCalendar", () => {
	const Url = "https://calendar.google.com/calendar/ical/site%40group.calendar.google.com/private-0123abcd/basic.ics";

	it("fetches and parses the feed", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(calendar(["UID:x", "DTSTART:20261110T180000Z", "DTEND:20261110T190000Z", "SUMMARY:Robot demo"]), {
					status: 200,
					headers: { "content-type": "text/calendar" },
				}),
		);

		const events = await fetchSiteCalendar(Url, {
			now: new Date("2026-11-08T00:00:00Z"),
			timeZone: TimeZone,
			fetch: fetch as unknown as typeof globalThis.fetch,
		});

		expect(fetch).toHaveBeenCalledOnce();
		expect(events.map(e => e.title)).toEqual(["Robot demo"]);
	});

	it("never puts the secret URL in an error", async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError(
				`fetch failed for ${Url} (GET /calendar/ical/site%40group.calendar.google.com/private-0123abcd/basic.ics)`,
			);
		});

		const error = await fetchSiteCalendar(Url, {
			timeZone: TimeZone,
			fetch: fetch as unknown as typeof globalThis.fetch,
		}).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(SiteCalendarError);
		expect(String((error as Error).message)).not.toContain("private-0123abcd");
	});

	it("reports an HTTP failure by status only", async () => {
		const fetch = vi.fn(async () => new Response("Not found", { status: 404 }));

		await expect(
			fetchSiteCalendar(Url, { timeZone: TimeZone, fetch: fetch as unknown as typeof globalThis.fetch }),
		).rejects.toThrow("Site calendar responded 404");
	});
});
