/** Focus and visibility events can come in bursts, so a check this soon after the last is skipped. */
export const MIN_CHECK_GAP_MS = 30 * 1000;

export type UpdateCheckerDeps = {
	/** The version this page was served by. */
	currentVersion: string;
	/** The version the server is running now, or null if it couldn't be found out. */
	fetchVersion: () => Promise<string | null>;
	/** False while a reload would cost someone what they're doing. */
	isSafeToReload: () => boolean;
	/** Must survive the reload, and answer true if it can't tell. See `reloadIfSafe`. */
	alreadyReloadedFor: (version: string) => boolean;
	rememberReloadFor: (version: string) => void;
	reload: () => void;
	now?: () => number;
};

/**
 * Moves an open tab onto the version the server is running, which otherwise
 * stays on whatever it loaded until someone reloads it by hand.
 */
export function createUpdateChecker({
	currentVersion,
	fetchVersion,
	isSafeToReload,
	alreadyReloadedFor,
	rememberReloadFor,
	reload,
	now = Date.now,
}: UpdateCheckerDeps) {
	let newVersion: string | null = null;
	let lastCheck = Number.NEGATIVE_INFINITY;

	/**
	 * Only once for any version. If a reload doesn't get this tab onto the new
	 * version, trying again would loop, and a tab that reloads forever is far
	 * worse than an old one.
	 */
	function reloadIfSafe() {
		if (newVersion === null || alreadyReloadedFor(newVersion) || !isSafeToReload()) return;

		rememberReloadFor(newVersion);
		reload();
	}

	async function check() {
		const time = now();
		if (time - lastCheck < MIN_CHECK_GAP_MS) return;
		lastCheck = time;

		const version = await fetchVersion();
		// Mid-deploy this fails. That says nothing about which version is coming, so keep what's known.
		if (version === null) return;

		// Comparing every time means a rollback cancels a reload that was still waiting
		newVersion = version === currentVersion ? null : version;
		reloadIfSafe();
	}

	return { check, reloadIfSafe };
}
