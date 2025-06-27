import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "src"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["allure-vitest/setup"],
		reporters: [
			"verbose",
			[
				"allure-vitest/reporter",
				{
					resultsDir: "allure-results",
				},
			],
		],
		exclude: [...configDefaults.exclude, "test/e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
		},
	},
});
