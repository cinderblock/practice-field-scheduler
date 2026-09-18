"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import styles from "./ErrorReporter.module.css";

type Shown = { id: number; message: string };

/**
 * Catches what nothing else caught -- uncaught exceptions and unhandled
 * promise rejections -- reports them to the backend with who and where, and
 * says so in a corner of the page instead of failing silently. Each distinct
 * message is reported and shown once per page load.
 */
export function ErrorReporter() {
	const { mutate: report } = api.errors.report.useMutation();
	const [shown, setShown] = useState<Shown[]>([]);

	useEffect(() => {
		const seen = new Set<string>();
		let nextId = 0;

		function record(kind: string, message: string, stack: string | undefined) {
			const text = message || "Unknown error";
			const key = `${kind}:${text}`;
			if (seen.has(key)) return;
			seen.add(key);
			report({ kind, message: text, detail: stack?.slice(0, 8000), page: window.location.pathname });
			const id = nextId++;
			setShown(list => [...list, { id, message: text }]);
		}

		const onError = (event: ErrorEvent) => {
			record("unhandled", event.message, event.error instanceof Error ? event.error.stack : undefined);
		};
		const onRejection = (event: PromiseRejectionEvent) => {
			const reason: unknown = event.reason;
			const message = reason instanceof Error ? reason.message : String(reason);
			record("unhandled-rejection", message, reason instanceof Error ? reason.stack : undefined);
		};

		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);
		return () => {
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
		};
	}, [report]);

	if (shown.length === 0) return null;

	return (
		<output className={styles.stack} aria-live="polite">
			{shown.map(item => (
				<div key={item.id} className={styles.toast}>
					<div className={styles.toastTitle}>Something went wrong</div>
					<div className={styles.toastMessage}>{item.message}</div>
					<div className={styles.toastHint}>It's been recorded. If it keeps happening, reload the page.</div>
					<button
						type="button"
						className={styles.dismiss}
						onClick={() => setShown(list => list.filter(i => i.id !== item.id))}
					>
						Dismiss
					</button>
				</div>
			))}
		</output>
	);
}
