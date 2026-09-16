/**
 * Load `.env.test` into `process.env` before any test module is evaluated.
 *
 * Vitest does not populate `process.env` from dotenv files, but `src/env.js` validates against it
 * at import time. Without this, importing any module that reaches `~/env` throws
 * "Invalid environment variables" before a single test runs.
 *
 * Real values already in the environment (CI secrets, a developer's shell) win over the file.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(import.meta.dirname, "..", ".env.test");

if (existsSync(envFile)) {
	// An empty value counts as absent, matching `emptyStringAsUndefined` in src/env.js. CI forwards
	// some values from repository vars/secrets, and an unset one arrives as "" rather than missing;
	// left in place it would fail validation instead of falling back to the test value.
	for (const [key, value] of Object.entries(process.env)) {
		if (value === "") delete process.env[key];
	}

	// Variables already set are left alone by loadEnvFile, so a real environment wins for free.
	process.loadEnvFile(envFile);
}
