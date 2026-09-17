"use client";

import { useState } from "react";
import { describeSlackNameIssue } from "~/server/util/slackName";
import { api } from "~/trpc/react";
import ui from "./adminUi.module.css";
import styles from "./SlackNamesPanel.module.css";

type Outcome = { slackId: string; name: string; ok: boolean; error?: string };

type RunResult = {
	dryRun: boolean;
	total: number;
	succeeded: number;
	failed: number;
	outcomes: Outcome[];
};

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Admin panel for the Slack name rules. Lists everyone in the Slack workspace
 * whose names need fixing (including people who've never signed in here),
 * from the scheduler's regular sync, and can DM them personalised fix-it
 * instructions. Gate links wait on these names.
 */
export function SlackNamesPanel() {
	const report = api.slack.nameReport.useQuery();
	const checkNow = api.slack.checkNamesNow.useMutation();
	const nudge = api.slack.nudgeNameProblems.useMutation();
	const [lastRun, setLastRun] = useState<RunResult | null>(null);
	const [running, setRunning] = useState<"preview" | "send" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmingSend, setConfirmingSend] = useState(false);

	const busy = checkNow.isPending || nudge.isPending;

	async function doCheck() {
		setError(null);
		setLastRun(null);
		try {
			await checkNow.mutateAsync();
			await report.refetch();
		} catch (e) {
			setError((e as Error).message);
		}
	}

	async function run(dryRun: boolean) {
		setError(null);
		setConfirmingSend(false);
		setRunning(dryRun ? "preview" : "send");
		try {
			setLastRun(await nudge.mutateAsync({ dryRun }));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setRunning(null);
		}
	}

	if (report.isLoading) return <div className={ui.panel}>Loading Slack names…</div>;
	if (report.error) return <div className={ui.panel}>Couldn't load Slack names: {report.error.message}</div>;
	const data = report.data;
	if (!data) return null;

	const count = data.problems.length;
	const haveList = data.checkedAt !== null;
	const checkedAt = data.checkedAt ? new Date(data.checkedAt).toLocaleString() : null;

	return (
		<section className={ui.panel}>
			<div className={ui.panelHeader}>
				<h2 className={ui.panelTitle}>Slack names</h2>
				<p className={ui.panelSubtitle}>
					{!haveList
						? "Names haven't been read from Slack yet."
						: count === 0
							? `All ${plural(data.memberCount, "person", "people")} in Slack follow the format.`
							: `${count} of ${plural(data.memberCount, "person", "people")} in Slack need to fix their names.`}
				</p>
			</div>

			<p className={cx(ui.note, styles.rules)}>
				<strong>Full name</strong>: just a name, e.g. <code>Jane Doe</code>. <strong>Display name</strong>: the name,
				then team number(s) in parentheses, e.g. <code>Jane Doe (1234)</code> or <code>Jane Doe (TSL)</code>. Gate links
				wait until both are right.
			</p>

			{data.status === "not_configured" && (
				<p className={ui.warning}>
					<code>SLACK_BOT_TOKEN</code> isn't configured, so names can't be checked and nobody's gate links go out.
				</p>
			)}
			{data.status === "missing_scope" && (
				<p className={ui.warning}>
					The Slack bot token lacks the <code>users:read</code> scope, so names can't be checked and nobody's gate links
					go out. Add the scope in the Slack app's settings and reinstall the app.
				</p>
			)}
			{data.status === "error" && (
				<p className={ui.warning}>
					The last check failed ({data.error}).{haveList && " Showing the previous results."}
				</p>
			)}

			{checkedAt && <p className={cx(ui.note, styles.spaced)}>Checked {checkedAt}. Rechecked every 10 minutes.</p>}

			{count > 0 && (
				<details className={styles.details}>
					<summary>Show who ({count})</summary>
					<ul className={styles.people}>
						{data.problems.map(p => (
							<li key={p.slackId} className={styles.person}>
								<div className={styles.names}>
									<span className={styles.name}>{p.displayName || p.realName || p.slackId}</span>
									{p.userId && <span className={cx(ui.chip, ui.chipInfo)}>Uses the scheduler</span>}
								</div>
								<dl className={styles.current}>
									<dt>Full name</dt>
									<dd>{p.realName ? <code>{p.realName}</code> : <em>empty</em>}</dd>
									<dt>Display name</dt>
									<dd>{p.displayName ? <code>{p.displayName}</code> : <em>empty</em>}</dd>
								</dl>
								<ul className={styles.issues}>
									{p.issues.map(issue => (
										<li key={issue}>{describeSlackNameIssue(issue)}</li>
									))}
								</ul>
								{p.suggestion && (
									<p className={ui.note}>
										Suggested:{" "}
										{p.suggestion.realName && (
											<>
												full name <code>{p.suggestion.realName}</code>
											</>
										)}
										{p.suggestion.realName && p.suggestion.displayName && ", "}
										{p.suggestion.displayName && (
											<>
												display name <code>{p.suggestion.displayName}</code>
											</>
										)}
									</p>
								)}
							</li>
						))}
					</ul>
				</details>
			)}

			{confirmingSend ? (
				<div className={styles.confirm}>
					<p className={ui.note}>
						DM {count === 1 ? "this person" : `all ${count} people`} what to fix? Each message shows their current names
						and suggested ones.
					</p>
					<div className={ui.buttonRow}>
						<button type="button" onClick={() => run(false)} disabled={busy} className={cx(ui.button, ui.danger)}>
							{running === "send" ? "Sending…" : "Yes, send"}
						</button>
						<button type="button" onClick={() => setConfirmingSend(false)} disabled={busy} className={ui.button}>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<div className={ui.buttonRow}>
					<button type="button" onClick={doCheck} disabled={busy} className={ui.button}>
						{checkNow.isPending ? "Checking…" : "Check now"}
					</button>
					{count > 0 && (
						<>
							<button type="button" onClick={() => run(true)} disabled={busy} className={ui.button}>
								{running === "preview" ? "Counting…" : "Preview DMs"}
							</button>
							<button
								type="button"
								onClick={() => setConfirmingSend(true)}
								disabled={busy || data.status !== "ok"}
								className={cx(ui.button, ui.primary)}
							>
								Send DMs…
							</button>
						</>
					)}
				</div>
			)}

			{error && <p className={cx(ui.error, styles.spaced)}>Error: {error}</p>}
			{lastRun && (
				<div className={styles.spaced}>
					<p className={lastRun.failed > 0 ? ui.error : ui.success}>
						{lastRun.dryRun ? "Preview: would DM" : "DM'd"} {lastRun.succeeded} of {lastRun.total}
						{lastRun.failed > 0 && ` — ${lastRun.failed} couldn't be reached`}.
					</p>
					{lastRun.failed > 0 && (
						<ul className={styles.issues}>
							{lastRun.outcomes
								.filter(o => !o.ok)
								.map(o => (
									<li key={o.slackId}>
										{o.name}: {o.error}
									</li>
								))}
						</ul>
					)}
				</div>
			)}
		</section>
	);
}
