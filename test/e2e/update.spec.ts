import { expect, type Page, test } from "@playwright/test";

const fiveMinutes = 5 * 60 * 1000 + 1000;

/** Answers `/api/version` with a build that isn't this page's, and counts how often the page loads. */
async function serveNewVersion(page: Page) {
	const loads = { count: 0 };
	page.on("load", () => loads.count++);
	await page.route("**/api/version", route => route.fulfill({ json: { version: "a-newer-build" } }));
	return loads;
}

test("the server reports the version pages are served with", async ({ request }) => {
	const response = await request.get("/api/version");

	expect(response.headers()["cache-control"]).toContain("no-store");
	expect((await response.json()).version).toEqual(expect.any(String));
});

test("a tab on an old version reloads once, and doesn't loop", async ({ page }) => {
	const loads = await serveNewVersion(page);

	await page.goto("/login");

	await expect.poll(() => loads.count).toBe(2);
	await page.waitForTimeout(4000);
	expect(loads.count).toBe(2);
});

test("a tab waits while someone is typing, then reloads", async ({ page }) => {
	// Before the page loads, or the watcher's timers would already be running on the real clock
	await page.clock.install();
	await page.goto("/login");
	await page.waitForLoadState("networkidle");
	await page.evaluate(() => {
		const input = document.createElement("input");
		input.id = "typing";
		document.body.append(input);
		input.focus();
	});
	const loads = await serveNewVersion(page);

	await page.clock.runFor(fiveMinutes);
	await page.waitForTimeout(500);
	expect(loads.count).toBe(0);

	await page.evaluate(() => (document.getElementById("typing") as HTMLInputElement).blur());
	await page.clock.runFor(4000);

	await expect.poll(() => loads.count).toBeGreaterThan(0);
});
