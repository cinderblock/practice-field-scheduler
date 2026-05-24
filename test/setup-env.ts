import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Push `.env.test` values into `process.env` before any test file imports
// `~/env`, so the strict env-validation in src/env.js passes. Real process
// env (e.g. CI-provided secrets) wins over what's in the file.
const envPath = resolve(__dirname, "../.env.test");

try {
	const content = readFileSync(envPath, "utf-8");
	const parsed = parseEnv(content);
	for (const [key, value] of Object.entries(parsed)) {
		const current = process.env[key];
		if (current === undefined || current === "") {
			process.env[key] = value;
		}
	}
} catch (err) {
	if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
