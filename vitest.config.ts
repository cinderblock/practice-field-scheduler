import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "src"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		exclude: [...configDefaults.exclude, "test/e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
		},
	},
});
