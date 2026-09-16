"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import styles from "./TeamAccessPanel.module.css";

type RevealState = { team: string; url: string | null; token: string };

/**
 * Admin panel for the per-team gate links.
 *
 * The token itself is deliberately not part of the listing — it's a bearer
 * secret, and the list renders every team at once. An admin reveals the one
 * team they actually need to hand over, and that reveal is audited.
 */
export function TeamAccessPanel() {
	const config = api.access.config.useQuery();
	const list = api.access.teams.list.useQuery();
	const reveal = api.access.teams.reveal.useMutation();
	const rotate = api.access.teams.rotate.useMutation();

	const [revealed, setRevealed] = useState<RevealState | null>(null);
	const [confirmingRotate, setConfirmingRotate] = useState<string | null>(null);
	const [busyTeam, setBusyTeam] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [lastRotation, setLastRotation] = useState<{
		team: string;
		notified: number;
		failed: number;
		slackConfigured: boolean;
	} | null>(null);
	const [copied, setCopied] = useState(false);

	async function doReveal(team: string) {
		setError(null);
		setLastRotation(null);
		setCopied(false);
		setBusyTeam(team);
		try {
			const result = await reveal.mutateAsync({ team });
			setRevealed({ team: result.team, url: result.url, token: result.token });
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusyTeam(null);
		}
	}

	async function doRotate(team: string) {
		setError(null);
		setConfirmingRotate(null);
		setRevealed(null);
		setBusyTeam(team);
		try {
			const result = await rotate.mutateAsync({ team });
			setLastRotation(result);
			await list.refetch();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusyTeam(null);
		}
	}

	async function copyRevealed(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
		} catch {
			setError("Couldn't copy to the clipboard — select the link and copy it manually.");
		}
	}

	if (list.isLoading || config.isLoading) return <div className={styles.panel}>Loading team gate links…</div>;
	const loadError = list.error ?? config.error;
	if (loadError) return <div className={styles.panel}>Couldn't load team gate links: {loadError.message}</div>;

	const teams = list.data;
	const cfg = config.data;
	if (!teams || !cfg) return null;

	return (
		<div className={styles.panel}>
			<div className={styles.headerRow}>
				<strong>Team gate links</strong>
				<span className={styles.subtle}>
					One shared link per team, working around that team's reservations (never outside {cfg.siteHours}). Links reset
					each new year.
				</span>
			</div>

			{!cfg.gateUrlConfigured && (
				<div className={styles.warning}>
					<code>GATE_BASE_URL</code> isn't configured, so links can't be built or sent. Set it on the scheduler.
				</div>
			)}
			{!cfg.slackConfigured && (
				<div className={styles.warning}>
					<code>SLACK_BOT_TOKEN</code> isn't configured, so rotating won't DM anyone the new link. Reveal it and pass it
					along manually.
				</div>
			)}

			{teams.length === 0 ? (
				<div className={styles.emptyState}>
					No teams yet. Teams appear here once someone logs in with a team number in their Slack display name.
				</div>
			) : (
				<table className={styles.table}>
					<thead>
						<tr>
							<th>Team</th>
							<th>Members</th>
							<th>Link</th>
							<th>Last issued</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{teams.map(t => {
							const issued = t.rotated ?? t.created;
							const busy = busyTeam === t.team;
							return (
								<tr key={t.team}>
									<td>
										<strong>{t.team}</strong>
									</td>
									<td data-label="Members">{t.memberCount}</td>
									<td data-label="Link">
										{t.hasLink ? (
											<span className={styles.issued}>issued</span>
										) : (
											<span className={styles.notIssued}>not issued yet</span>
										)}
									</td>
									<td className={styles.dateCell} data-label="Last issued">
										{issued ? new Date(issued).toLocaleDateString() : "—"}
										{t.rotated && <span className={styles.subtle}> (rotated)</span>}
									</td>
									<td className={styles.actionCell}>
										{confirmingRotate === t.team ? (
											<span className={styles.confirmBar}>
												<span>Rotate? Every current bookmark for team {t.team} stops working.</span>
												<button
													type="button"
													onClick={() => doRotate(t.team)}
													disabled={busy}
													className={`${styles.button} ${styles.buttonDanger}`}
												>
													{busy ? "Rotating…" : "Yes, rotate"}
												</button>
												<button
													type="button"
													onClick={() => setConfirmingRotate(null)}
													disabled={busy}
													className={styles.button}
												>
													Cancel
												</button>
											</span>
										) : (
											<span className={styles.actions}>
												<button
													type="button"
													onClick={() => doReveal(t.team)}
													disabled={busy || !cfg.gateUrlConfigured}
													className={styles.button}
												>
													{busy && reveal.isPending ? "Revealing…" : "Reveal link"}
												</button>
												<button
													type="button"
													onClick={() => setConfirmingRotate(t.team)}
													disabled={busy}
													className={styles.button}
												>
													Rotate
												</button>
											</span>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}

			{revealed && (
				<div className={styles.revealBlock}>
					<div className={styles.revealHeader}>
						<strong>Team {revealed.team}'s link</strong>
						<span className={styles.subtle}>Treat it like a key — anyone with it can open the gate in-window.</span>
					</div>
					<div className={styles.revealRow}>
						<code className={styles.revealUrl}>{revealed.url ?? revealed.token}</code>
						{revealed.url && (
							<button type="button" onClick={() => copyRevealed(revealed.url as string)} className={styles.button}>
								{copied ? "Copied" : "Copy"}
							</button>
						)}
						<button
							type="button"
							onClick={() => {
								setRevealed(null);
								setCopied(false);
							}}
							className={styles.button}
						>
							Hide
						</button>
					</div>
				</div>
			)}

			{lastRotation && (
				<div className={styles.resultBlock}>
					Team {lastRotation.team} rotated.{" "}
					{!lastRotation.slackConfigured
						? "Slack isn't configured, so nobody was DM'd — reveal the link and pass it on."
						: lastRotation.notified === 0 && lastRotation.failed === 0
							? "No members with a Slack account to DM — reveal the link and pass it on."
							: `DM'd ${lastRotation.notified} member${lastRotation.notified === 1 ? "" : "s"}${
									lastRotation.failed > 0 ? `, ${lastRotation.failed} failed` : ""
								}. Anyone missed picks up the new link at their next sign-in.`}
				</div>
			)}

			{error && <div className={styles.errorText}>Error: {error}</div>}
		</div>
	);
}
