"use client";

import { useEffect } from "react";
import { api } from "~/trpc/react";
import styles from "./error.module.css";

/**
 * What Next.js renders when a page throws. Reports the failure to the backend
 * (with who and where, for review later) and says plainly what to do next,
 * instead of a blank page.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	const { mutate: report } = api.errors.report.useMutation();

	useEffect(() => {
		report({
			kind: "render",
			message: error.message || "Unknown error",
			detail: [error.digest && `digest: ${error.digest}`, error.stack].filter(Boolean).join("\n").slice(0, 8000),
			page: window.location.pathname,
		});
	}, [error, report]);

	return (
		<main className={styles.main}>
			<div className={styles.card}>
				<h2 className={styles.title}>Something went wrong</h2>
				<p className={styles.message}>{error.message || "The page hit an error it couldn't recover from."}</p>
				<p className={styles.hint}>
					It's been recorded. Try again, or reload the page; if it keeps happening, tell an admin.
				</p>
				<div className={styles.actions}>
					<button type="button" className={styles.button} onClick={() => reset()}>
						Try again
					</button>
					<button type="button" className={styles.buttonSecondary} onClick={() => window.location.reload()}>
						Reload
					</button>
				</div>
			</div>
		</main>
	);
}
