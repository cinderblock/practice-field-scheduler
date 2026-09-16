"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import styles from "./NameAuditPanel.module.css";

type Outcome = {
	userId: string;
	slackId: string;
	ok: boolean;
	error?: string;
};

type RunResult = {
	dryRun: boolean;
	total: number;
	succeeded: number;
	failed: number;
	outcomes: Outcome[];
};

export function NameAuditPanel() {
	const invalidList = api.slack.listUsersWithInvalidNames.useQuery();
	const slackConfigured = api.slack.isConfigured.useQuery();
	const nudge = api.slack.nudgeUsersWithInvalidNames.useMutation();
	const [lastRun, setLastRun] = useState<RunResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmingSend, setConfirmingSend] = useState(false);

	async function run(dryRun: boolean) {
		setError(null);
		setConfirmingSend(false);
		try {
			const result = await nudge.mutateAsync({ dryRun });
			setLastRun(result);
			if (!dryRun) await invalidList.refetch();
		} catch (e) {
			setError((e as Error).message);
		}
	}

	if (invalidList.isLoading) return <div className={styles.panel}>Loading user name audit…</div>;
	if (invalidList.error)
		return <div className={styles.panel}>Couldn't load user audit: {invalidList.error.message}</div>;

	const entries = invalidList.data ?? [];
	const count = entries.length;
	const slackReady = slackConfigured.data === true;
	const isDryRunInFlight = nudge.isPending && lastRun?.dryRun !== false;
	const isRealRunInFlight = nudge.isPending && lastRun?.dryRun === false;

	return (
		<div className={styles.panel}>
			<div className={styles.headerRow}>
				<strong>Slack-name audit:</strong>
				<span>
					{count === 0 ? "Everyone's name is in the expected format. 🎉" : `${count} user(s) with invalid Slack names.`}
				</span>
				{count > 0 && !confirmingSend && (
					<div className={styles.actions}>
						<button type="button" onClick={() => run(true)} disabled={nudge.isPending} className={styles.button}>
							{isDryRunInFlight ? "Working…" : "Preview (dry run)"}
						</button>
						<button
							type="button"
							onClick={() => setConfirmingSend(true)}
							disabled={nudge.isPending || !slackReady}
							className={`${styles.button} ${styles.buttonPrimary}`}
						>
							Send DMs…
						</button>
						{!slackReady && <span className={styles.noSlackId}>SLACK_BOT_TOKEN is not configured</span>}
					</div>
				)}
				{count > 0 && confirmingSend && (
					<div className={`${styles.actions} ${styles.confirmBar}`}>
						<span>DM all {count} users?</span>
						<button
							type="button"
							onClick={() => run(false)}
							disabled={nudge.isPending}
							className={`${styles.button} ${styles.buttonDanger}`}
						>
							{isRealRunInFlight ? "Sending…" : "Yes, send"}
						</button>
						<button
							type="button"
							onClick={() => setConfirmingSend(false)}
							disabled={nudge.isPending}
							className={styles.button}
						>
							Cancel
						</button>
					</div>
				)}
			</div>

			{count > 0 && (
				<details className={styles.detailsBlock}>
					<summary>Show offending users</summary>
					<ul className={styles.userList}>
						{entries.map(entry => (
							<li key={entry.userId}>
								<code>{entry.currentName || "(empty name)"}</code>
								{entry.slackIds.length === 0 && <span className={styles.noSlackId}>(no Slack ID — can't DM)</span>}
							</li>
						))}
					</ul>
				</details>
			)}

			{error && <div className={styles.errorText}>Error: {error}</div>}
			{lastRun && (
				<div className={styles.resultBlock}>
					<strong>{lastRun.dryRun ? "Dry run" : "Run"} complete:</strong> {lastRun.succeeded}/{lastRun.total} succeeded
					{lastRun.failed > 0 && <span>, {lastRun.failed} failed</span>}.
					{lastRun.failed > 0 && (
						<ul className={styles.failureList}>
							{lastRun.outcomes
								.filter(o => !o.ok)
								.map(o => (
									<li key={`${o.userId}-${o.slackId}`}>
										User {o.userId} (slack {o.slackId || "?"}): {o.error}
									</li>
								))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}
