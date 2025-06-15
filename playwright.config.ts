import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = 3001;

export default defineConfig({
	testDir: "test/e2e",
	timeout: 30 * 1000,
	outputDir: "test-results",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
	},
	webServer: {
		command: `cross-env DATA_DIR=.tmp/e2e-data TEST_AUTH_BYPASS=1 npm run preview -- --port ${PORT}`,
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
