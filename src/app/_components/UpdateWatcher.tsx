"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAppConfig } from "./AppConfig";
import { createUpdateChecker } from "./updateChecker";

const CHECK_EVERY_MS = 5 * 60 * 1000;
/** How often a waiting update looks again, so it goes through soon after a dialog closes. */
const RETRY_EVERY_MS = 3 * 1000;
const RELOADED_FOR_KEY = "reloadedForVersion";

let holds = 0;

/**
 * Keeps this tab on its current version while `active`. For anything a reload
 * would lose that the watcher can't see for itself, like an open dialog or a
 * link that's only ever shown once.
 */
export function useHoldUpdate(active: boolean) {
	useEffect(() => {
		if (!active) return;
		holds++;
		return () => {
			holds--;
		};
	}, [active]);
}

function isTyping() {
	const element = document.activeElement;
	if (element instanceof HTMLInputElement) return !["button", "checkbox", "radio", "submit"].includes(element.type);
	return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

async function fetchVersion() {
	try {
		const response = await fetch("/api/version", { cache: "no-store" });
		if (!response.ok) return null;
		const { version } = (await response.json()) as { version?: unknown };
		return typeof version === "string" && version !== "" ? version : null;
	} catch {
		return null;
	}
}

function alreadyReloadedFor(version: string) {
	try {
		return sessionStorage.getItem(RELOADED_FOR_KEY) === version;
	} catch {
		// Can't remember a reload, so can't rule out a loop: stay on this version
		return true;
	}
}

function rememberReloadFor(version: string) {
	sessionStorage.setItem(RELOADED_FOR_KEY, version);
}

/** Reloads the tab when a new version is live and nothing would be lost. Shows nothing. */
export function UpdateWatcher() {
	const { version: currentVersion } = useAppConfig();
	const queryClient = useQueryClient();

	useEffect(() => {
		if (currentVersion === null) return;

		const { check, reloadIfSafe } = createUpdateChecker({
			currentVersion,
			fetchVersion,
			isSafeToReload: () => holds === 0 && queryClient.isMutating() === 0 && !isTyping(),
			alreadyReloadedFor,
			rememberReloadFor,
			reload: () => window.location.reload(),
		});

		const checkIfVisible = () => {
			if (document.visibilityState === "visible") void check();
		};

		void check();
		const checking = setInterval(() => void check(), CHECK_EVERY_MS);
		const retrying = setInterval(reloadIfSafe, RETRY_EVERY_MS);
		window.addEventListener("focus", checkIfVisible);
		document.addEventListener("visibilitychange", checkIfVisible);

		return () => {
			clearInterval(checking);
			clearInterval(retrying);
			window.removeEventListener("focus", checkIfVisible);
			document.removeEventListener("visibilitychange", checkIfVisible);
		};
	}, [currentVersion, queryClient]);

	return null;
}
