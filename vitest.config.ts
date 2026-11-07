import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	// tsconfig says jsx: "preserve" for Next.js; Vite 8's Oxc transform honours
	// that and leaves JSX in place, so compile it here for the tests.
	oxc: { jsx: { runtime: "automatic" } },
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "src"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["./test/setup-env.ts", "allure-vitest/setup"],
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
