import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3001;

export default defineConfig({
	testDir: "test/e2e",
	timeout: 30 * 1000,
	outputDir: "test-results",
	reporter: [["line"], ["allure-playwright"]],
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
	},
	webServer: {
		command: `cross-env NODE_ENV=test npm run preview -- --port ${PORT}`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 120 * 1000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
