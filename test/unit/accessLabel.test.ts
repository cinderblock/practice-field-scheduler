import { describe, expect, it } from "vitest";
import { personalLinkLabel, teamLinkLabel } from "~/server/util/accessLabel";

describe("gate link labels", () => {
	it("names a team by its number", () => {
		expect(teamLinkLabel(1234)).toBe("team-1234");
	});

	it("makes house teams URL-safe", () => {
		expect(teamLinkLabel("Tom Sawyer Labs!")).toBe("team-tom-sawyer-labs");
		expect(teamLinkLabel("!!!")).toBe("team");
	});

	it("uses first name, last initial and every team number", () => {
		expect(personalLinkLabel({ name: "Jane Doe", teams: [1234, 5678] })).toBe("jane-d-1234-5678");
		expect(personalLinkLabel({ name: "Mary Jane van Doe", teams: [1234] })).toBe("mary-d-1234");
	});

	it("handles a single name, and an admin who has no team numbers", () => {
		expect(personalLinkLabel({ name: "Cher", teams: [1234] })).toBe("cher-1234");
		expect(personalLinkLabel({ name: "Ada Admin", teams: "admin" })).toBe("ada-a");
	});

	it("keeps only URL-safe ASCII", () => {
		expect(personalLinkLabel({ name: "José O'Brien", teams: [] })).toBe("jose-o");
		expect(personalLinkLabel({ name: "山田 太郎", teams: [254] })).toBe("254");
		expect(personalLinkLabel({ name: "山田 太郎", teams: [] })).toBe("member");
	});

	it("caps the length without leaving a trailing hyphen", () => {
		const label = personalLinkLabel({ name: "A".repeat(60), teams: [1234] });
		expect(label.length).toBeLessThanOrEqual(48);
		expect(label).toMatch(/^[a-z0-9-]*[a-z0-9]$/);
	});
});
