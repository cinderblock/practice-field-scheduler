import { readFileSync } from "node:fs";
import { join } from "node:path";

let version: string | null | undefined;

/**
 * Which build this server is running, from the id `next build` writes. Null if
 * there isn't one, which turns off tabs watching for updates.
 */
export function buildVersion(): string | null {
	if (version === undefined) {
		try {
			version = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || null;
		} catch {
			version = null;
		}
	}
	return version;
}
