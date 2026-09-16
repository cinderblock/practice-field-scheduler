"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import ui from "./adminUi.module.css";
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

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

/**
 * Admin panel listing people whose Slack display name doesn't match the
 * "First Last (1234)" convention, with a way to DM them all fix-it
 * instructions. Use it before turning on STRICT_SLACK_NAMES.
 */
export function NameAuditPanel() {
	const invalidList = api.slack.listUsersWithInvalidNames.useQuery();
	const slackConfigured = api.slack.isConfigured.useQuery();
	const nudge = api.slack.nudgeUsersWithInvalidNames.useMutation();
	const [lastRun, setLastRun] = useState<RunResult | null>(null);
	const [running, setRunning] = useState<"preview" | "send" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmingSend, setConfirmingSend] = useState(false);

	async function run(dryRun: boolean) {
		setError(null);
		setConfirmingSend(false);
		setRunning(dryRun ? "preview" : "send");
		try {
			const result = await nudge.mutateAsync({ dryRun });
			setLastRun(result);
			if (!dryRun) await invalidList.refetch();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setRunning(null);
		}
	}

	if (invalidList.isLoading) return <div className={ui.panel}>Loading Slack-name audit…</div>;
	if (invalidList.error)
		return <div className={ui.panel}>Couldn't load the Slack-name audit: {invalidList.error.message}</div>;

	const entries = invalidList.data ?? [];
	const count = entries.length;
	const slackReady = slackConfigured.data === true;

	return (
		<section className={ui.panel}>
			<div className={ui.panelHeader}>
				<h2 className={ui.panelTitle}>Slack-name audit</h2>
				<p className={ui.panelSubtitle}>
					{count === 0
						? "Everyone's name is in the “First Last (1234)” format."
						: `${count} ${count === 1 ? "person's name isn't" : "people's names aren't"} in the “First Last (1234)” format.`}
				</p>
			</div>

			{count > 0 && (
				<>
					<details className={styles.details}>
						<summary>Show who</summary>
						<ul className={styles.userList}>
							{entries.map(entry => (
								<li key={entry.userId}>
									<code>{entry.currentName || "(empty name)"}</code>
									{entry.slackIds.length === 0 && <span className={ui.note}> — no Slack ID, can't DM</span>}
								</li>
							))}
						</ul>
					</details>

					{confirmingSend ? (
						<div className={styles.confirm}>
							<p className={ui.note}>
								DM {count === 1 ? "this person" : `all ${count} people`} instructions for fixing their name?
							</p>
							<div className={ui.buttonRow}>
								<button
									type="button"
									onClick={() => run(false)}
									disabled={nudge.isPending}
									className={cx(ui.button, ui.danger)}
								>
									{running === "send" ? "Sending…" : "Yes, send"}
								</button>
								<button
									type="button"
									onClick={() => setConfirmingSend(false)}
									disabled={nudge.isPending}
									className={ui.button}
								>
									Cancel
								</button>
							</div>
						</div>
					) : (
						<div className={ui.buttonRow}>
							<button type="button" onClick={() => run(true)} disabled={nudge.isPending} className={ui.button}>
								{running === "preview" ? "Checking…" : "Preview DMs"}
							</button>
							<button
								type="button"
								onClick={() => setConfirmingSend(true)}
								disabled={nudge.isPending || !slackReady}
								className={cx(ui.button, ui.primary)}
							>
								Send DMs…
							</button>
						</div>
					)}

					{!slackReady && (
						<p className={cx(ui.note, styles.spaced)}>
							Sending is unavailable: <code>SLACK_BOT_TOKEN</code> isn't configured.
						</p>
					)}
				</>
			)}

			{error && <p className={cx(ui.error, styles.spaced)}>Error: {error}</p>}
			{lastRun && (
				<div className={styles.spaced}>
					<p className={lastRun.failed > 0 ? ui.error : ui.success}>
						{lastRun.dryRun ? "Preview: would DM" : "DM'd"} {lastRun.succeeded} of {lastRun.total}
						{lastRun.failed > 0 && ` — ${lastRun.failed} can't be reached`}.
					</p>
					{lastRun.failed > 0 && (
						<ul className={styles.userList}>
							{lastRun.outcomes
								.filter(o => !o.ok)
								.map(o => (
									<li key={`${o.userId}-${o.slackId}`} className={ui.note}>
										User {o.userId} (Slack {o.slackId || "?"}): {o.error}
									</li>
								))}
						</ul>
					)}
				</div>
			)}
		</section>
	);
}
