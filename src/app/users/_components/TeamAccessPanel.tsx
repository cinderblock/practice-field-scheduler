"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import ui from "./adminUi.module.css";
import styles from "./TeamAccessPanel.module.css";

type RevealState = { team: string; url: string | null; token: string };
type Rotation = { team: string; notified: number; failed: number; held: number; slackConfigured: boolean };

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

function issuedText(t: { hasLink: boolean; created: Date | null; rotated: Date | null }): string {
	if (!t.hasLink) return "no link yet";
	const when = t.rotated ?? t.created;
	const date = when ? new Date(when).toLocaleDateString() : "";
	return t.rotated ? `replaced ${date}` : `issued ${date}`;
}

function heldText(held: number): string {
	if (held === 0) return "";
	return held === 1
		? " 1 member's Slack names need fixing, so they get it once they're fixed."
		: ` ${held} members' Slack names need fixing, so they get it once theirs are fixed.`;
}

function rotationText(r: Rotation): string {
	if (!r.slackConfigured) return "Slack isn't configured, so nobody was DM'd — reveal the link and pass it on.";
	if (r.notified === 0 && r.failed === 0) {
		return r.held > 0
			? `Nobody was DM'd.${heldText(r.held)}`
			: "No members with a Slack account to DM — reveal the link and pass it on.";
	}
	const dmd = `DM'd ${r.notified} member${r.notified === 1 ? "" : "s"}`;
	return `${dmd}${r.failed > 0 ? `, ${r.failed} failed` : ""}. Anyone missed gets the new link at their next sign-in.${heldText(r.held)}`;
}

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
	const [lastRotation, setLastRotation] = useState<Rotation | null>(null);
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
			setLastRotation(await rotate.mutateAsync({ team }));
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
			setError("Couldn't copy — select the link and copy it manually.");
		}
	}

	if (list.isLoading || config.isLoading) return <div className={ui.panel}>Loading team gate links…</div>;
	const loadError = list.error ?? config.error;
	if (loadError) return <div className={ui.panel}>Couldn't load team gate links: {loadError.message}</div>;

	const teams = list.data;
	const cfg = config.data;
	if (!teams || !cfg) return null;

	return (
		<section className={ui.panel}>
			<div className={ui.panelHeader}>
				<h2 className={ui.panelTitle}>Team gate links</h2>
				<p className={ui.panelSubtitle}>
					One shared link per team, working around its reservations ({cfg.siteHours} only). Links reset each year.
				</p>
			</div>

			{!cfg.gateUrlConfigured && (
				<p className={ui.warning}>
					<code>GATE_BASE_URL</code> isn't configured, so links can't be built or sent.
				</p>
			)}
			{!cfg.slackConfigured && (
				<p className={ui.warning}>
					<code>SLACK_BOT_TOKEN</code> isn't configured, so nobody is DM'd — reveal links and pass them on.
				</p>
			)}

			{teams.length === 0 ? (
				<p className={ui.note}>
					No teams yet. Teams appear once someone signs in with a team number in their Slack display name.
				</p>
			) : (
				<ul className={styles.list}>
					{teams.map(t => {
						const busy = busyTeam === t.team;
						const confirming = confirmingRotate === t.team;
						return (
							<li key={t.team} className={styles.row}>
								<div className={styles.summary}>
									<span className={styles.team}>{t.team}</span>
									<span className={ui.note}>
										{t.memberCount} member{t.memberCount === 1 ? "" : "s"} · {issuedText(t)}
									</span>
								</div>

								{confirming ? (
									<div className={styles.confirm}>
										<p className={ui.note}>Rotate? Every current bookmark for team {t.team} stops working.</p>
										<div className={ui.buttonRow}>
											<button
												type="button"
												onClick={() => doRotate(t.team)}
												disabled={busy}
												className={cx(ui.button, ui.danger)}
											>
												{busy ? "Rotating…" : "Yes, rotate"}
											</button>
											<button
												type="button"
												onClick={() => setConfirmingRotate(null)}
												disabled={busy}
												className={ui.button}
											>
												Cancel
											</button>
										</div>
									</div>
								) : (
									<div className={cx(ui.buttonRow, styles.actions)}>
										<button
											type="button"
											onClick={() => doReveal(t.team)}
											disabled={busy || !cfg.gateUrlConfigured}
											className={ui.button}
										>
											{busy && reveal.isPending ? "Revealing…" : "Reveal link"}
										</button>
										<button
											type="button"
											onClick={() => setConfirmingRotate(t.team)}
											disabled={busy}
											className={ui.button}
										>
											Rotate
										</button>
									</div>
								)}

								{revealed?.team === t.team && (
									<div className={styles.reveal}>
										<p className={ui.note}>Treat it like a key — anyone with it can open the gate in-window.</p>
										<code className={ui.linkBox}>{revealed.url ?? revealed.token}</code>
										<div className={ui.buttonRow}>
											{revealed.url && (
												<button
													type="button"
													onClick={() => copyRevealed(revealed.url as string)}
													className={ui.button}
												>
													{copied ? "Copied" : "Copy"}
												</button>
											)}
											<button
												type="button"
												onClick={() => {
													setRevealed(null);
													setCopied(false);
												}}
												className={ui.button}
											>
												Hide
											</button>
										</div>
									</div>
								)}

								{lastRotation?.team === t.team && <p className={ui.success}>Rotated. {rotationText(lastRotation)}</p>}
							</li>
						);
					})}
				</ul>
			)}

			{error && <p className={ui.error}>Error: {error}</p>}
		</section>
	);
}
