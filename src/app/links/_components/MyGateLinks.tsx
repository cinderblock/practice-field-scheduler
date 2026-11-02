"use client";

import { useState } from "react";
import { useHoldUpdate } from "~/app/_components/UpdateWatcher";
import ui from "~/app/users/_components/adminUi.module.css";
import styles from "~/app/users/_components/TeamAccessPanel.module.css";
import { api } from "~/trpc/react";

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

/** `personal`, or the team the link belongs to. */
type LinkKey = "personal" | `team:${string}`;

type Revealed = { key: LinkKey; url: string | null; token: string };

function issuedText(link: { created: Date; rotated: Date | null }): string {
	const when = new Date(link.rotated ?? link.created).toLocaleDateString();
	return link.rotated ? `replaced ${when}` : `issued ${when}`;
}

/**
 * The signed-in person's own gate links: show one, or replace it if it got out.
 *
 * Replacing a team link changes it for the whole team, which is why it asks
 * first and says so. Tokens are only fetched when someone asks to see one.
 */
export function MyGateLinks() {
	const list = api.access.mine.list.useQuery();
	const revealTeam = api.access.mine.revealTeam.useMutation();
	const revealPersonal = api.access.mine.revealPersonal.useMutation();
	const rotateTeam = api.access.mine.rotateTeam.useMutation();
	const rotatePersonal = api.access.mine.rotatePersonal.useMutation();

	const [revealed, setRevealed] = useState<Revealed | null>(null);
	const [confirming, setConfirming] = useState<LinkKey | null>(null);
	const [busy, setBusy] = useState<LinkKey | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<{ key: LinkKey; text: string } | null>(null);
	const [copied, setCopied] = useState(false);
	useHoldUpdate(revealed !== null || confirming !== null || result !== null);

	async function doReveal(key: LinkKey, team?: string) {
		setError(null);
		setResult(null);
		setCopied(false);
		setBusy(key);
		try {
			const link = team === undefined ? await revealPersonal.mutateAsync() : await revealTeam.mutateAsync({ team });
			setRevealed({ key, url: link.url, token: link.token });
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(null);
		}
	}

	async function doRotate(key: LinkKey, team?: string) {
		setError(null);
		setConfirming(null);
		setRevealed(null);
		setBusy(key);
		try {
			let text: string;
			if (team === undefined) {
				const r = await rotatePersonal.mutateAsync();
				text = r.notified > 0 ? "Replaced. Your new link is in your Slack DMs." : "Replaced. Show it below to copy it.";
			} else {
				const r = await rotateTeam.mutateAsync({ team });
				text = r.notified > 0 ? `Replaced. DM'd ${r.notified} team member${r.notified === 1 ? "" : "s"}.` : "Replaced.";
			}
			setResult({ key, text });
			await list.refetch();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(null);
		}
	}

	async function copy(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
		} catch {
			setError("Couldn't copy — select the link and copy it manually.");
		}
	}

	if (list.isLoading) return <div className={ui.panel}>Loading your gate links…</div>;
	if (list.error) return <div className={ui.panel}>Couldn't load your gate links: {list.error.message}</div>;
	const links = list.data;
	if (!links) return null;

	function row(key: LinkKey, title: string, detail: string, warning: string, team?: string) {
		const isBusy = busy === key;
		return (
			<li key={key} className={styles.row}>
				<div className={styles.summary}>
					<span className={styles.team}>{title}</span>
					<span className={ui.note}>{detail}</span>
				</div>

				{confirming === key ? (
					<div className={styles.confirm}>
						<p className={ui.note}>{warning}</p>
						<div className={ui.buttonRow}>
							<button
								type="button"
								onClick={() => doRotate(key, team)}
								disabled={isBusy}
								className={cx(ui.button, ui.danger)}
							>
								{isBusy ? "Replacing…" : "Yes, replace it"}
							</button>
							<button type="button" onClick={() => setConfirming(null)} disabled={isBusy} className={ui.button}>
								Cancel
							</button>
						</div>
					</div>
				) : (
					<div className={cx(ui.buttonRow, styles.actions)}>
						<button
							type="button"
							onClick={() => doReveal(key, team)}
							disabled={isBusy || !links?.gateUrlConfigured}
							className={ui.button}
						>
							Show link
						</button>
						<button type="button" onClick={() => setConfirming(key)} disabled={isBusy} className={ui.button}>
							Replace
						</button>
					</div>
				)}

				{revealed?.key === key && (
					<div className={styles.reveal}>
						<p className={ui.note}>Treat it like a key: anyone with it can open the gate.</p>
						<code className={ui.linkBox}>{revealed.url ?? revealed.token}</code>
						<div className={ui.buttonRow}>
							{revealed.url && (
								<button type="button" onClick={() => copy(revealed.url as string)} className={ui.button}>
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

				{result?.key === key && <p className={ui.success}>{result.text}</p>}
			</li>
		);
	}

	const none = !links.held && !links.personal && links.teams.length === 0;

	return (
		<section className={ui.panel}>
			<div className={ui.panelHeader}>
				<h2 className={ui.panelTitle}>Your links</h2>
				<p className={ui.panelSubtitle}>
					Links open the practice-field gate, {links.siteHours} only. If one gets out, replace it. Links also reset each
					year.
				</p>
			</div>

			{links.held && (
				<p className={ui.warning}>Your links are on hold. Your Slack names may need fixing, or ask an admin.</p>
			)}
			{none && <p className={ui.note}>You don't have any gate links yet.</p>}

			{(links.personal || links.teams.length > 0) && (
				<ul className={styles.list}>
					{links.personal &&
						row(
							"personal",
							"Your personal link",
							issuedText(links.personal),
							"Replace it? Your current link and any bookmark of it stop working right away.",
						)}
					{links.teams.map(t =>
						row(
							`team:${t.team}`,
							`Team ${t.team}`,
							`${t.memberCount} member${t.memberCount === 1 ? "" : "s"} · ${issuedText(t)}`,
							`Replace it for everyone? Team ${t.team}'s bookmarks stop working right away. The team gets a Slack DM naming you.`,
							t.team,
						),
					)}
				</ul>
			)}

			{error && <p className={ui.error}>Error: {error}</p>}
		</section>
	);
}
