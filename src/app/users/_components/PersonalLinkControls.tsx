"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import styles from "./PersonalLinkControls.module.css";

export type PersonalLinkStatus = "active" | "not_issued" | "blocked" | "invalid_name" | "disabled";

const STATUS_TEXT: Record<PersonalLinkStatus, string> = {
	active: "Personal link: active",
	not_issued: "Personal link: sent at next sign-in",
	blocked: "Personal link: blocked (shared/unverified account)",
	invalid_name: "Personal link: none — Slack name isn't in the expected format",
	disabled: "Personal link: none — account disabled",
};

type Confirming = "rotate" | "block" | null;

/**
 * Admin controls for one person's personal gate link, shown under their name
 * in the users table so they stay usable on a phone.
 */
export function PersonalLinkControls({
	userId,
	status,
	gateUrlConfigured,
	onChanged,
}: {
	userId: string;
	status: PersonalLinkStatus;
	gateUrlConfigured: boolean;
	onChanged: () => Promise<unknown>;
}) {
	const reveal = api.access.personal.reveal.useMutation();
	const rotate = api.access.personal.rotate.useMutation();
	const setBlocked = api.access.personal.setBlocked.useMutation();

	const [revealed, setRevealed] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [confirming, setConfirming] = useState<Confirming>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const busy = reveal.isPending || rotate.isPending || setBlocked.isPending;
	const canHoldLink = status === "active" || status === "not_issued";

	async function run(action: () => Promise<string | null>) {
		setError(null);
		setMessage(null);
		setConfirming(null);
		try {
			setMessage(await action());
		} catch (e) {
			setError((e as Error).message);
		}
	}

	const doReveal = () =>
		run(async () => {
			const result = await reveal.mutateAsync({ userId });
			setCopied(false);
			setRevealed(result.url ?? result.token);
			await onChanged();
			return null;
		});

	const doRotate = () =>
		run(async () => {
			setRevealed(null);
			const result = await rotate.mutateAsync({ userId });
			await onChanged();
			if (result.notified > 0) return "Replaced and DM'd the new link.";
			return result.failed > 0
				? "Replaced, but the DM failed — reveal the link and pass it on."
				: "Replaced. No Slack account to DM — reveal the link and pass it on.";
		});

	const doSetBlocked = (blocked: boolean) =>
		run(async () => {
			setRevealed(null);
			await setBlocked.mutateAsync({ userId, blocked });
			await onChanged();
			return blocked
				? "Blocked. The old link no longer works."
				: "Unblocked. A new link is sent at their next sign-in.";
		});

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			setError("Couldn't copy — select the link and copy it manually.");
		}
	}

	return (
		<div className={styles.controls}>
			<span className={status === "active" ? styles.statusActive : styles.status}>{STATUS_TEXT[status]}</span>

			{confirming === "rotate" && (
				<span className={styles.row}>
					<span>Replace it? The current link stops working.</span>
					<button type="button" onClick={doRotate} disabled={busy} className={`${styles.button} ${styles.danger}`}>
						{rotate.isPending ? "Replacing…" : "Yes, replace"}
					</button>
					<button type="button" onClick={() => setConfirming(null)} disabled={busy} className={styles.button}>
						Cancel
					</button>
				</span>
			)}

			{confirming === "block" && (
				<span className={styles.row}>
					<span>Block this account's personal link? Its current link stops working.</span>
					<button
						type="button"
						onClick={() => doSetBlocked(true)}
						disabled={busy}
						className={`${styles.button} ${styles.danger}`}
					>
						{setBlocked.isPending ? "Blocking…" : "Yes, block"}
					</button>
					<button type="button" onClick={() => setConfirming(null)} disabled={busy} className={styles.button}>
						Cancel
					</button>
				</span>
			)}

			{confirming === null && status !== "disabled" && (
				<span className={styles.row}>
					{canHoldLink && (
						<>
							<button type="button" onClick={doReveal} disabled={busy || !gateUrlConfigured} className={styles.button}>
								{reveal.isPending ? "Revealing…" : "Reveal"}
							</button>
							<button type="button" onClick={() => setConfirming("rotate")} disabled={busy} className={styles.button}>
								Replace
							</button>
						</>
					)}
					{status === "blocked" ? (
						<button type="button" onClick={() => doSetBlocked(false)} disabled={busy} className={styles.button}>
							{setBlocked.isPending ? "Unblocking…" : "Unblock"}
						</button>
					) : (
						<button type="button" onClick={() => setConfirming("block")} disabled={busy} className={styles.button}>
							Mark as shared account
						</button>
					)}
				</span>
			)}

			{revealed && (
				<span className={styles.row}>
					<code className={styles.url}>{revealed}</code>
					<button type="button" onClick={() => copy(revealed)} className={styles.button}>
						{copied ? "Copied" : "Copy"}
					</button>
					<button type="button" onClick={() => setRevealed(null)} className={styles.button}>
						Hide
					</button>
				</span>
			)}

			{message && <span className={styles.message}>{message}</span>}
			{error && <span className={styles.error}>Error: {error}</span>}
		</div>
	);
}
