import { describe, expect, it, vi } from "vitest";
import { createUpdateChecker, MIN_CHECK_GAP_MS } from "~/app/_components/updateChecker";

function setup(answers: (string | null)[]) {
	const state = { safe: true, time: 0, reloads: [] as string[], remembered: new Set<string>() };
	const fetchVersion = vi.fn(async () => answers.shift() ?? null);
	const checker = createUpdateChecker({
		currentVersion: "old",
		fetchVersion,
		isSafeToReload: () => state.safe,
		alreadyReloadedFor: version => state.remembered.has(version),
		rememberReloadFor: version => state.remembered.add(version),
		reload: () => state.reloads.push("reload"),
		now: () => state.time,
	});
	const checkLater = () => {
		state.time += MIN_CHECK_GAP_MS;
		return checker.check();
	};
	return { ...checker, checkLater, fetchVersion, state };
}

describe("the update checker", () => {
	it("leaves a tab on the running version alone", async () => {
		const { check, state } = setup(["old"]);
		await check();
		expect(state.reloads).toHaveLength(0);
	});

	it("reloads when the server is on a new version", async () => {
		const { check, state } = setup(["new"]);
		await check();
		expect(state.reloads).toHaveLength(1);
	});

	it("waits until it's safe", async () => {
		const { check, reloadIfSafe, state } = setup(["new"]);
		state.safe = false;

		await check();
		reloadIfSafe();
		expect(state.reloads).toHaveLength(0);

		state.safe = true;
		reloadIfSafe();
		expect(state.reloads).toHaveLength(1);
	});

	it("never reloads twice for one version, so it can't loop", async () => {
		const { check, checkLater, reloadIfSafe, state } = setup(["new", "new"]);

		await check();
		reloadIfSafe();
		await checkLater();
		reloadIfSafe();

		expect(state.reloads).toHaveLength(1);
	});

	it("doesn't reload again for a version an earlier page load already tried", async () => {
		const { check, state } = setup(["new"]);
		state.remembered.add("new");

		await check();

		expect(state.reloads).toHaveLength(0);
	});

	it("still reloads for the version after that", async () => {
		const { check, checkLater, state } = setup(["new", "newer"]);

		await check();
		await checkLater();

		expect(state.reloads).toHaveLength(2);
	});

	it("drops a waiting reload if the server rolls back", async () => {
		const { check, checkLater, reloadIfSafe, state } = setup(["new", "old"]);
		state.safe = false;
		await check();

		await checkLater();
		state.safe = true;
		reloadIfSafe();

		expect(state.reloads).toHaveLength(0);
	});

	it("ignores a failed check, and keeps a reload that's waiting", async () => {
		const { check, checkLater, reloadIfSafe, state } = setup(["new", null]);
		state.safe = false;
		await check();

		await checkLater();
		state.safe = true;
		reloadIfSafe();

		expect(state.reloads).toHaveLength(1);
	});

	it("does nothing on a failure with no version known", async () => {
		const { check, state } = setup([null]);
		await check();
		expect(state.reloads).toHaveLength(0);
	});

	it("skips a check right after another", async () => {
		const { check, fetchVersion } = setup(["old", "old"]);

		await check();
		await check();

		expect(fetchVersion).toHaveBeenCalledOnce();
	});
});
