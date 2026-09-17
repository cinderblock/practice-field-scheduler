"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import type { PersonalAccessStatus } from "~/types";
import ui from "./adminUi.module.css";
import styles from "./GeneralAccessControls.module.css";

const STATUS: Record<PersonalAccessStatus, { chip: string; tone: string; detail?: string }> = {
	active: { chip: "Approved", tone: ui.chipGood as string },
	not_issued: { chip: "Approved", tone: ui.chipInfo as string, detail: "Their link goes out at their next sign-in." },
	not_approved: { chip: "Not approved", tone: ui.chipMuted as string },
	invalid_name: {
		chip: "Approved · link on hold",
		tone: ui.chipWarn as string,
		detail: "Held until their Slack names follow the format.",
	},
	disabled: { chip: "Account disabled", tone: ui.chipMuted as string },
};

type Confirming = "rotate" | "revoke" | null;

type Delivery = {
	notified: number;
	failed: number;
	skipped: "slack_not_configured" | "no_slack_account" | null;
};

/** Explain what happened to the DM that should have carried a new link. */
function deliveryText(done: string, d: Delivery): string {
	if (d.notified > 0) return `${done} and DM'd the link.`;
	if (d.skipped === "slack_not_configured")
		return `${done}. Slack isn't configured, so nobody was DM'd — reveal the link and pass it on.`;
	if (d.skipped === "no_slack_account")
		return `${done}. There's no Slack account on file to DM — reveal the link and pass it on.`;
	return `${done}, but the DM failed — reveal the link and pass it on.`;
}

const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ");

/**
 * Admin controls for one person's general gate access. General gate access is
 * an explicit grant: approving issues the person's personal link (usable any
 * day within site hours) and DMs it; revoking deletes it.
 */
export function GeneralAccessControls({
	userId,
	status,
	gateUrlConfigured,
	onChanged,
}: {
	userId: string;
	status: PersonalAccessStatus;
	gateUrlConfigured: boolean;
	onChanged: () => Promise<unknown>;
}) {
	const reveal = api.access.personal.reveal.useMutation();
	const rotate = api.access.personal.rotate.useMutation();
	const setApproved = api.access.personal.setApproved.useMutation();

	const [revealed, setRevealed] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [confirming, setConfirming] = useState<Confirming>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const busy = reveal.isPending || rotate.isPending || setApproved.isPending;
	const approved = status === "active" || status === "not_issued" || status === "invalid_name";
	const hasUsableLink = status === "active" || status === "not_issued";
	const { chip, tone, detail } = STATUS[status];

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
			return deliveryText("Replaced", result);
		});

	const doApprove = () =>
		run(async () => {
			const result = await setApproved.mutateAsync({ userId, approved: true });
			await onChanged();
			if (!result.linkIssued) return "Approved. Their link goes out once their Slack names follow the format.";
			if (result.notified === 0 && result.failed === 0 && result.skipped === null)
				return "Approved. They already have their link.";
			return deliveryText("Approved", result);
		});

	const doRevoke = () =>
		run(async () => {
			setRevealed(null);
			await setApproved.mutateAsync({ userId, approved: false });
			await onChanged();
			return "Revoked. Their personal link no longer works.";
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
			<div className={styles.statusLine}>
				<span className={styles.label}>General gate access</span>
				<span className={cx(ui.chip, tone)}>{chip}</span>
			</div>
			{detail && <p className={ui.note}>{detail}</p>}

			{confirming && (
				<div className={styles.confirm}>
					<p className={ui.note}>
						{confirming === "rotate"
							? "Replace their link? The current one stops working."
							: "Revoke general gate access? Their personal link stops working."}
					</p>
					<div className={ui.buttonRow}>
						<button
							type="button"
							onClick={confirming === "rotate" ? doRotate : doRevoke}
							disabled={busy}
							className={cx(ui.button, ui.danger)}
						>
							{confirming === "rotate"
								? rotate.isPending
									? "Replacing…"
									: "Yes, replace"
								: setApproved.isPending
									? "Revoking…"
									: "Yes, revoke"}
						</button>
						<button type="button" onClick={() => setConfirming(null)} disabled={busy} className={ui.button}>
							Cancel
						</button>
					</div>
				</div>
			)}

			{!confirming && status !== "disabled" && (
				<div className={ui.buttonRow}>
					{!approved && (
						<button type="button" onClick={doApprove} disabled={busy} className={cx(ui.button, ui.primary, ui.wide)}>
							{setApproved.isPending ? "Approving…" : "Approve general gate access"}
						</button>
					)}
					{hasUsableLink && (
						<>
							<button type="button" onClick={doReveal} disabled={busy || !gateUrlConfigured} className={ui.button}>
								{reveal.isPending ? "Revealing…" : "Reveal link"}
							</button>
							<button type="button" onClick={() => setConfirming("rotate")} disabled={busy} className={ui.button}>
								Replace link
							</button>
						</>
					)}
					{approved && (
						<button
							type="button"
							onClick={() => setConfirming("revoke")}
							disabled={busy}
							className={cx(ui.button, ui.dangerQuiet, hasUsableLink && ui.wide)}
						>
							Revoke access
						</button>
					)}
				</div>
			)}

			{revealed && (
				<div className={styles.reveal}>
					<code className={ui.linkBox}>{revealed}</code>
					<div className={ui.buttonRow}>
						<button type="button" onClick={() => copy(revealed)} className={ui.button}>
							{copied ? "Copied" : "Copy"}
						</button>
						<button type="button" onClick={() => setRevealed(null)} className={ui.button}>
							Hide
						</button>
					</div>
				</div>
			)}

			{message && <p className={ui.success}>{message}</p>}
			{error && <p className={ui.error}>Error: {error}</p>}
		</div>
	);
}
