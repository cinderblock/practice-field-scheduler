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
	const before = { ...process.env };

	process.loadEnvFile(envFile);

	for (const [key, value] of Object.entries(before)) {
		if (value !== undefined) process.env[key] = value;
	}
}
