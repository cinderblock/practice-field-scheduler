import { describe, expect, it } from "vitest";
import {
	ACCESS_POST_END_GRACE_MS,
	ACCESS_PRE_START_GRACE_MS,
	computeAccessWindow,
	currentOrNextSiteHours,
	describeSiteHours,
	evaluateAccess,
	formatHour,
	hasValidSlackNames,
	isPersonalAccessEligible,
	SITE_CLOSE_HOUR,
	SITE_OPEN_HOUR,
	slackNameCheckFor,
} from "~/server/access";
import type { Reservation, TeamFull, UserEntry } from "~/types";

const mentor: UserEntry = {
	id: "user-1",
	name: "Jane Doe",
	displayName: "Jane Doe (1234, 5678)",
	created: new Date("2026-05-01T00:00:00Z"),
	updated: new Date("2026-05-01T00:00:00Z"),
	teams: [1234, 5678],
	email: "jane@example.com",
	image: "",
	generalAccessApproved: true,
	slackNamesSyncedAt: new Date("2026-05-01T00:00:00Z"),
};

const teamReservation: Reservation = {
	id: "res-1",
	date: "2026-05-23",
	slot: "10:00am",
	created: new Date("2026-05-20T00:00:00Z"),
	userId: mentor.id,
	priority: false,
	team: 1234,
};

const team = (t: TeamFull, reservations: Reservation[], now: Date, tool = "gate") =>
	evaluateAccess({ kind: "team", team: t }, tool, reservations, now);

const personal = (user: UserEntry, now: Date, tool = "gate") =>
	evaluateAccess({ kind: "personal", user }, tool, [], now);

// 2026-05-23 is in PDT (UTC−7). The 10am slot runs to 4pm: 17:00Z–23:00Z.
// With the grace periods:
//   start = 17:00Z − 20m = 16:40Z
//   end   = 23:00Z + 60m = 00:00Z next day
const expectedStart = "2026-05-23T16:40:00.000Z";
const expectedEnd = "2026-05-24T00:00:00.000Z";

// Site hours that day: 8am–11pm PDT = 15:00Z – 06:00Z next day.
const siteOpen = "2026-05-23T15:00:00.000Z";
const siteClose = "2026-05-24T06:00:00.000Z";

const inside = new Date("2026-05-23T18:00:00Z");

describe("policy constants", () => {
	it("grace is 20 minutes before and 60 minutes after", () => {
		expect(ACCESS_PRE_START_GRACE_MS).toBe(20 * 60 * 1000);
		expect(ACCESS_POST_END_GRACE_MS).toBe(60 * 60 * 1000);
	});

	it("site hours are 8am to 11pm", () => {
		expect(SITE_OPEN_HOUR).toBe(8);
		expect(SITE_CLOSE_HOUR).toBe(23);
		expect(describeSiteHours()).toBe("8am–11pm");
	});

	it("formats hours on a 12-hour clock", () => {
		expect(formatHour(0)).toBe("12am");
		expect(formatHour(8)).toBe("8am");
		expect(formatHour(12)).toBe("12pm");
		expect(formatHour(23)).toBe("11pm");
	});
});

describe("currentOrNextSiteHours", () => {
	it("returns today's hours while the site is open", () => {
		const hours = currentOrNextSiteHours(inside);
		expect(hours.start.toISOString()).toBe(siteOpen);
		expect(hours.end.toISOString()).toBe(siteClose);
	});

	it("returns today's hours before opening", () => {
		// 7am PDT
		const hours = currentOrNextSiteHours(new Date("2026-05-23T14:00:00Z"));
		expect(hours.start.toISOString()).toBe(siteOpen);
	});

	it("returns tomorrow's hours after closing, across a month end", () => {
		// 11:30pm PDT on May 31
		const hours = currentOrNextSiteHours(new Date("2026-06-01T06:30:00Z"));
		expect(hours.start.toISOString()).toBe("2026-06-01T15:00:00.000Z");
		expect(hours.end.toISOString()).toBe("2026-06-02T06:00:00.000Z");
	});

	it("rolls over the year end, in standard time", () => {
		// 11:30pm PST on Dec 31 → Jan 1, 8am PST (UTC−8) = 16:00Z
		const hours = currentOrNextSiteHours(new Date("2027-01-01T07:30:00Z"));
		expect(hours.start.toISOString()).toBe("2027-01-01T16:00:00.000Z");
		expect(hours.end.toISOString()).toBe("2027-01-02T07:00:00.000Z");
	});
});

describe("computeAccessWindow", () => {
	it("pads the slot with the grace periods", () => {
		expect(computeAccessWindow(teamReservation)).toEqual({
			start: new Date(expectedStart),
			end: new Date(expectedEnd),
		});
	});

	it("clamps a late slot's tail to closing time", () => {
		// A 10pm slot has no next border, so it falls back to a 3h slot: 10pm–1am,
		// +60m grace. Only 9:40pm–11pm survives.
		const late: Reservation = { ...teamReservation, slot: "10:00pm" };
		expect(computeAccessWindow(late)).toEqual({
			start: new Date("2026-05-24T04:40:00.000Z"),
			end: new Date(siteClose),
		});
	});

	it("clamps an early slot's head to opening time", () => {
		// 8am slot − 20m would be 7:40am; the site doesn't open until 8.
		const early: Reservation = { ...teamReservation, slot: "8:00am" };
		expect(computeAccessWindow(early)?.start).toEqual(new Date(siteOpen));
	});

	it("returns null when nothing is left after clamping", () => {
		const overnight: Reservation = { ...teamReservation, slot: "11:30pm" };
		expect(computeAccessWindow(overnight)).toBeNull();
	});

	it("returns null for a malformed slot", () => {
		expect(computeAccessWindow({ ...teamReservation, slot: "noon" })).toBeNull();
	});
});

describe("team links", () => {
	it("are valid inside the window", () => {
		expect(team(1234, [teamReservation], inside)).toEqual({
			valid: true,
			grant: "team",
			tool: "gate",
			// Shared link: the scheduler can't know which person clicked.
			user: null,
			team: { id: "1234", name: "Team 1234" },
			reservation_id: "res-1",
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("are valid exactly when the window opens", () => {
		expect(team(1234, [teamReservation], new Date(expectedStart))).toMatchObject({ valid: true });
	});

	it("are refused a millisecond before the window opens", () => {
		const justBefore = new Date(new Date(expectedStart).getTime() - 1);
		expect(team(1234, [teamReservation], justBefore)).toMatchObject({ valid: false, reason: "outside_window" });
	});

	it("are refused once the window has closed", () => {
		expect(team(1234, [teamReservation], new Date(expectedEnd))).toMatchObject({
			valid: false,
			reason: "outside_window",
		});
	});

	it("are refused after 11pm even when a late reservation's grace would run on", () => {
		const late: Reservation = { ...teamReservation, slot: "10:00pm" };
		// 11:15pm PDT
		expect(team(1234, [late], new Date("2026-05-24T06:15:00Z"))).toMatchObject({
			valid: false,
			reason: "outside_window",
		});
	});

	it("report the nearest window on a denial so the UI can explain itself", () => {
		expect(team(1234, [teamReservation], new Date("2026-05-20T00:00:00Z"))).toEqual({
			valid: false,
			reason: "outside_window",
			grant: "team",
			tool: "gate",
			user: null,
			team: { id: "1234", name: "Team 1234" },
			window_starts_at: expectedStart,
			window_ends_at: expectedEnd,
		});
	});

	it("report null windows when the team has no reservations", () => {
		expect(team(1234, [], inside)).toMatchObject({
			valid: false,
			reason: "outside_window",
			grant: "team",
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		});
	});

	it("answer tool_not_authorized for unknown tools", () => {
		expect(team(1234, [teamReservation], inside, "lights")).toMatchObject({
			valid: false,
			reason: "tool_not_authorized",
			grant: "team",
			tool: "lights",
		});
	});

	it("ignore abandoned reservations", () => {
		const abandoned: Reservation = { ...teamReservation, abandoned: new Date("2026-05-22T00:00:00Z") };
		expect(team(1234, [abandoned], inside)).toMatchObject({ valid: false });
	});

	it("ignore other teams' reservations", () => {
		expect(team(5678, [teamReservation], inside)).toMatchObject({ valid: false, team: null });
	});

	it("match a numeric-string team against a numeric reservation", () => {
		expect(team("1234", [teamReservation], inside)).toMatchObject({ valid: true });
	});

	it("match non-numeric house teams by string", () => {
		const house: Reservation = { ...teamReservation, id: "res-house", team: "TSL" };
		expect(team("TSL", [house], inside)).toMatchObject({ valid: true, team: { id: "TSL", name: "Team TSL" } });
	});

	it("prefer an active reservation over a merely nearby one", () => {
		const earlier: Reservation = { ...teamReservation, id: "res-early", date: "2026-05-22" };
		expect(team(1234, [earlier, teamReservation], inside)).toMatchObject({ valid: true, reservation_id: "res-1" });
	});
});

describe("isPersonalAccessEligible", () => {
	it("accepts a member an admin approved", () => {
		expect(isPersonalAccessEligible(mentor)).toBe(true);
	});

	it("refuses everyone by default — general gate access must be granted", () => {
		const { generalAccessApproved: _, ...unapproved } = mentor;
		expect(isPersonalAccessEligible(unapproved)).toBe(false);
		expect(isPersonalAccessEligible({ ...mentor, generalAccessApproved: false })).toBe(false);
	});

	it("accepts approved admins and lab mates with a valid name — no team needed", () => {
		expect(isPersonalAccessEligible({ ...mentor, teams: "admin", displayName: "Ada Admin (1234)" })).toBe(true);
		expect(isPersonalAccessEligible({ ...mentor, teams: [], displayName: "Lab Mate (TSL)" })).toBe(true);
	});

	it("refuses disabled accounts, even if approved", () => {
		expect(isPersonalAccessEligible({ ...mentor, disabled: true })).toBe(false);
	});

	it("refuses an approved account whose Slack names don't follow the rules", () => {
		expect(isPersonalAccessEligible({ ...mentor, displayName: "Robotics Laptop", name: "Robotics Laptop" })).toBe(
			false,
		);
		expect(isPersonalAccessEligible({ ...mentor, name: "Jane Doe (1234)" })).toBe(false);
	});

	it("refuses an approved account whose names were never read from Slack", () => {
		const { slackNamesSyncedAt: _, ...unchecked } = mentor;
		expect(isPersonalAccessEligible(unchecked)).toBe(false);
	});
});

describe("slackNameCheckFor", () => {
	it("checks stored names once they've come from Slack", () => {
		expect(slackNameCheckFor(mentor).ok).toBe(true);
		expect(slackNameCheckFor({ ...mentor, displayName: undefined }).issues).toEqual(["display_name_missing"]);
	});

	it("counts names that never came from Slack as unverified, whatever they say", () => {
		expect(slackNameCheckFor({ ...mentor, slackNamesSyncedAt: undefined }).issues).toEqual(["unverified"]);
		expect(hasValidSlackNames({ ...mentor, slackNamesSyncedAt: undefined })).toBe(false);
	});
});

describe("personal links", () => {
	it("are valid any time during site hours, with no reservation", () => {
		expect(personal(mentor, inside)).toEqual({
			valid: true,
			grant: "personal",
			tool: "gate",
			user: { id: "user-1", name: "Jane Doe (1234, 5678)" },
			team: null,
			reservation_id: null,
			window_starts_at: siteOpen,
			window_ends_at: siteClose,
		});
	});

	it("are valid exactly at opening time", () => {
		expect(personal(mentor, new Date(siteOpen))).toMatchObject({ valid: true });
	});

	it("are refused before opening, pointing at today's hours", () => {
		expect(personal(mentor, new Date("2026-05-23T14:59:59Z"))).toMatchObject({
			valid: false,
			reason: "outside_window",
			grant: "personal",
			user: { id: "user-1" },
			window_starts_at: siteOpen,
		});
	});

	it("are refused from 11pm, pointing at tomorrow's opening", () => {
		expect(personal(mentor, new Date(siteClose))).toMatchObject({
			valid: false,
			reason: "outside_window",
			window_starts_at: "2026-05-24T15:00:00.000Z",
			window_ends_at: "2026-05-25T06:00:00.000Z",
		});
	});

	it("are revoked for an account that isn't (or is no longer) eligible", () => {
		for (const user of [
			{ ...mentor, disabled: true },
			{ ...mentor, generalAccessApproved: false },
			{ ...mentor, displayName: "Shared iPad", name: "Shared iPad" },
		]) {
			expect(personal(user, inside)).toMatchObject({ valid: false, reason: "revoked", grant: "personal" });
		}
	});

	it("report revoked before tool_not_authorized — an unapproved account grants nothing", () => {
		expect(personal({ ...mentor, disabled: true }, inside, "lights")).toMatchObject({ reason: "revoked" });
	});

	it("answer tool_not_authorized for an approved member asking about an unknown tool", () => {
		expect(personal(mentor, inside, "lights")).toMatchObject({ valid: false, reason: "tool_not_authorized" });
	});

	it("work for admins, who hold no team link", () => {
		expect(personal({ ...mentor, teams: "admin" }, inside)).toMatchObject({ valid: true });
	});
});

describe("unknown tokens", () => {
	it("are refused with no grant", () => {
		expect(evaluateAccess(undefined, "gate", [teamReservation], inside)).toEqual({
			valid: false,
			reason: "unknown_token",
			grant: null,
			tool: "gate",
			user: null,
			team: null,
			window_starts_at: null,
			window_ends_at: null,
		});
	});
});
