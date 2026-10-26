"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppConfig } from "~/app/_components/AppConfig";
import { FIELD_ISSUE_KINDS, fieldIssueKindInfo, sortSnapshots } from "~/server/util/fieldIssue";
import { formatHour, getTimeSlots } from "~/server/util/timeSlots";
import { dateToLocalString } from "~/server/util/timeUtils";
import { api } from "~/trpc/react";
import type { FieldIssue, FieldIssueKind, FieldIssueSnapshot } from "~/types";
import styles from "./IssuesList.module.css";

type Status = "open" | "resolved" | "all";

function snapshotUrl(issue: Pick<FieldIssue, "id">, snapshot: Pick<FieldIssueSnapshot, "file">): string {
	return `/api/issues/${issue.id}/snapshots/${snapshot.file}`;
}

function describeSnapshot(snapshot: FieldIssueSnapshot): string {
	return snapshot.source === "camera" ? `${snapshot.camera ?? "Shop"} camera` : "Photo from the reporter";
}

export function IssuesList({
	issues: initialIssues,
	people,
	camerasConfigured,
}: {
	issues: FieldIssue[];
	/** Display name by user id, for reporters and resolvers. */
	people: Record<string, string>;
	/** Whether reports can carry camera frames at all; shown when they don't. */
	camerasConfigured: boolean;
}) {
	const [status, setStatus] = useState<Status>("open");
	const [kind, setKind] = useState<FieldIssueKind | "">("");
	const [error, setError] = useState<string | null>(null);
	const [resolving, setResolving] = useState<{ id: string; note: string } | null>(null);
	const [lightbox, setLightbox] = useState<{ issue: FieldIssue; snapshot: FieldIssueSnapshot } | null>(null);

	const { timeSlotBorders } = useAppConfig();
	const slots = useMemo(() => getTimeSlots(timeSlotBorders), [timeSlotBorders]);

	const utils = api.useUtils();
	const { data: issues = initialIssues } = api.fieldIssue.list.useQuery(undefined, { initialData: initialIssues });

	const setResolved = api.fieldIssue.setResolved.useMutation({
		onSuccess: () => {
			utils.fieldIssue.list.invalidate();
			setResolving(null);
		},
		onError: err => setError(err.message),
	});

	const remove = api.fieldIssue.remove.useMutation({
		onSuccess: () => utils.fieldIssue.list.invalidate(),
		onError: err => setError(err.message),
	});

	useEffect(() => {
		if (!lightbox) return;
		function handleEsc(event: KeyboardEvent) {
			if (event.key === "Escape") setLightbox(null);
		}
		document.addEventListener("keydown", handleEsc);
		return () => document.removeEventListener("keydown", handleEsc);
	}, [lightbox]);

	const shown = issues.filter(issue => {
		if (status === "open" && issue.resolved) return false;
		if (status === "resolved" && !issue.resolved) return false;
		if (kind && issue.kind !== kind) return false;
		return true;
	});

	const openCount = issues.filter(i => !i.resolved).length;

	const describeSlot = (issue: FieldIssue) => {
		const match = slots.find(s => s.slot === issue.slot);
		return match ? `${formatHour(match.startHour)} – ${formatHour(match.endHour)}` : issue.slot;
	};

	const nameOf = (userId: string | undefined) => (userId && people[userId]) || "Unknown";

	const handleRemove = (issue: FieldIssue) => {
		if (!confirm(`Remove this ${fieldIssueKindInfo(issue.kind).label.toLowerCase()} report? It won't be shown again.`))
			return;
		setError(null);
		remove.mutate({ id: issue.id });
	};

	return (
		<div className={styles.container}>
			<p className={styles.intro}>
				Anyone signed in can report a problem with the field from the calendar: the <strong>!</strong> button on a time
				slot. Reports arrive here with the reporter&apos;s photos
				{camerasConfigured ? " and a frame from the shop cameras" : ""}. Mark one resolved once it&apos;s been dealt
				with.
				{!camerasConfigured && (
					<>
						{" "}
						Shop camera frames are off: set <code>FIELD_CAMERAS</code> to include them.
					</>
				)}
			</p>

			{error && (
				<div className={styles.error} role="alert">
					{error}
					<button type="button" className={styles.dismiss} onClick={() => setError(null)} aria-label="Dismiss">
						×
					</button>
				</div>
			)}

			<div className={styles.filters}>
				<div className={styles.statusTabs} role="tablist">
					{(["open", "resolved", "all"] as const).map(s => (
						<button
							key={s}
							type="button"
							role="tab"
							aria-selected={status === s}
							className={`${styles.tab} ${status === s ? styles.tabActive : ""}`}
							onClick={() => setStatus(s)}
						>
							{s === "open" ? `Open (${openCount})` : s === "resolved" ? "Resolved" : "All"}
						</button>
					))}
				</div>
				<select value={kind} onChange={e => setKind(e.target.value as FieldIssueKind | "")} className={styles.select}>
					<option value="">All kinds</option>
					{FIELD_ISSUE_KINDS.map(k => (
						<option key={k.kind} value={k.kind}>
							{k.label}
						</option>
					))}
				</select>
			</div>

			{shown.length === 0 ? (
				<p className={styles.empty}>
					{status === "open" && !kind ? "Nothing open. The field has no reported problems." : "No reports match."}
				</p>
			) : (
				<div className={styles.list}>
					{shown.map(issue => {
						const info = fieldIssueKindInfo(issue.kind);
						const snapshots = sortSnapshots(issue.snapshots);
						const isResolving = resolving?.id === issue.id;

						return (
							<article
								key={issue.id}
								className={`${styles.card} ${issue.resolved ? styles.cardResolved : ""} ${styles[`kind_${issue.kind}`] ?? ""}`}
							>
								<header className={styles.cardHeader}>
									<span className={`${styles.chip} ${styles[`chip_${issue.kind}`] ?? ""}`}>{info.label}</span>
									<span className={styles.when}>{dateToLocalString(new Date(issue.created))}</span>
								</header>

								<div className={styles.meta}>
									<span>
										By <strong>{nameOf(issue.userId)}</strong>
										{issue.team ? ` (team ${issue.team})` : ""}
									</span>
									<span>
										About {issue.date}, {describeSlot(issue)}
									</span>
								</div>

								{issue.notes ? (
									<p className={styles.notes}>{issue.notes}</p>
								) : (
									<p className={styles.noNotes}>No details given.</p>
								)}

								{snapshots.length > 0 && (
									<ul className={styles.snapshots}>
										{snapshots.map(snapshot => (
											<li key={snapshot.id}>
												<button
													type="button"
													className={styles.thumb}
													onClick={() => setLightbox({ issue, snapshot })}
													aria-label={`Open ${describeSnapshot(snapshot)}`}
												>
													{/* biome-ignore lint/performance/noImgElement: served by our own admin-gated route; next/image can't fetch it */}
													<img src={snapshotUrl(issue, snapshot)} alt="" loading="lazy" />
													<span className={styles.thumbLabel}>
														{snapshot.source === "camera" ? (snapshot.camera ?? "Camera") : "Photo"}
													</span>
												</button>
											</li>
										))}
									</ul>
								)}

								{issue.resolved && (
									<div className={styles.resolution}>
										<strong>Resolved</strong> by {nameOf(issue.resolvedBy)} on{" "}
										{dateToLocalString(new Date(issue.resolved))}
										{issue.resolution && <div className={styles.resolutionNote}>{issue.resolution}</div>}
									</div>
								)}

								{isResolving ? (
									<form
										className={styles.resolveForm}
										onSubmit={e => {
											e.preventDefault();
											setError(null);
											setResolved.mutate({ id: issue.id, resolved: true, resolution: resolving.note });
										}}
									>
										<input
											type="text"
											value={resolving.note}
											onChange={e => setResolving({ id: issue.id, note: e.target.value })}
											placeholder="What was done (optional)"
											maxLength={2000}
											// biome-ignore lint/a11y/noAutofocus: the admin just asked for this field
											autoFocus
										/>
										<button type="submit" className={styles.primary} disabled={setResolved.isPending}>
											{setResolved.isPending ? "Saving…" : "Mark resolved"}
										</button>
										<button type="button" className={styles.secondary} onClick={() => setResolving(null)}>
											Cancel
										</button>
									</form>
								) : (
									<div className={styles.actions}>
										{issue.resolved ? (
											<button
												type="button"
												className={styles.secondary}
												onClick={() => {
													setError(null);
													setResolved.mutate({ id: issue.id, resolved: false });
												}}
												disabled={setResolved.isPending}
											>
												Reopen
											</button>
										) : (
											<button
												type="button"
												className={styles.primary}
												onClick={() => setResolving({ id: issue.id, note: "" })}
											>
												Resolve…
											</button>
										)}
										<button
											type="button"
											className={styles.danger}
											onClick={() => handleRemove(issue)}
											disabled={remove.isPending}
										>
											Remove
										</button>
									</div>
								)}
							</article>
						);
					})}
				</div>
			)}

			{lightbox && (
				<div className={styles.lightbox}>
					<button
						type="button"
						className={styles.lightboxBackdrop}
						onClick={() => setLightbox(null)}
						aria-label="Close"
					/>
					<figure>
						{/* biome-ignore lint/performance/noImgElement: served by our own admin-gated route; next/image can't fetch it */}
						<img src={snapshotUrl(lightbox.issue, lightbox.snapshot)} alt={describeSnapshot(lightbox.snapshot)} />
						<figcaption>
							{describeSnapshot(lightbox.snapshot)}, {dateToLocalString(new Date(lightbox.snapshot.taken))}
							{" · "}
							<a href={snapshotUrl(lightbox.issue, lightbox.snapshot)} target="_blank" rel="noreferrer">
								Open full size
							</a>
						</figcaption>
					</figure>
					<button type="button" className={styles.lightboxClose} onClick={() => setLightbox(null)} aria-label="Close">
						×
					</button>
				</div>
			)}
		</div>
	);
}
