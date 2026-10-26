"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAppConfig } from "~/app/_components/AppConfig";
import { describeRequestError } from "~/app/_components/clientErrors";
import type { CameraOutcome } from "~/server/backend";
import { FIELD_ISSUE_KINDS, fieldIssueKindInfo, MAX_PHOTOS_PER_ISSUE, PHOTO_MAX_SIDE } from "~/server/util/fieldIssue";
import { api } from "~/trpc/react";
import type { FieldIssue, FieldIssueKind } from "~/types";
import styles from "./ReportFieldIssue.module.css";

/*
 * The "report a field issue" button that sits in every time slot beside the add button,
 * and the dialog it opens.
 *
 * Filing is two steps. The report itself goes over tRPC and comes back with the outcome
 * of each shop camera; then each photo from the phone is uploaded to the report on its
 * own, so a flaky connection at the field loses a picture, not the report, and the
 * failed ones can be retried from the same dialog.
 */

type PhotoStatus = "pending" | "uploading" | "done" | "failed";

type Photo = {
	id: string;
	/** Downscaled in the browser; see `shrinkPhoto`. */
	blob: Blob;
	name: string;
	previewUrl: string;
	status: PhotoStatus;
	error?: string;
};

type Phase = "editing" | "filing" | "uploading" | "done";

/**
 * Shrink a photo before upload. Phones hand over 12 MP originals of several MB; nothing
 * in a damage report needs more than PHOTO_MAX_SIDE pixels across. Orientation comes from
 * the EXIF data so a portrait shot stays portrait. If any of this fails (an old browser,
 * an odd file) the original goes up instead and the server still caps its size.
 */
async function shrinkPhoto(file: File): Promise<Blob> {
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
		try {
			const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
			// Already small and already a JPEG: send as is.
			if (scale === 1 && file.type === "image/jpeg" && file.size < 1_500_000) return file;

			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const context = canvas.getContext("2d");
			if (!context) return file;
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

			const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
			return blob ?? file;
		} finally {
			bitmap.close();
		}
	} catch {
		return file;
	}
}

async function uploadPhoto(issueId: string, photo: Photo): Promise<void> {
	const body = new FormData();
	body.append("photo", photo.blob, photo.name);
	let res: Response;
	try {
		res = await fetch(`/api/issues/${issueId}/photos`, { method: "POST", body });
	} catch {
		throw new Error("Couldn't reach the server");
	}
	if (res.ok) return;
	let message = `Upload failed (${res.status})`;
	try {
		const data: unknown = await res.json();
		if (data && typeof data === "object" && "error" in data && typeof data.error === "string") message = data.error;
	} catch {
		// The status will have to do
	}
	throw new Error(message);
}

export function ReportFieldIssueButton({
	date,
	slot,
	heading,
	className,
}: {
	date: string;
	slot: string;
	/** The day and time this slot is, rendered the way the calendar does it. */
	heading: React.ReactNode;
	/** Positioning within the slot; the dialog's own look comes from this component. */
	className?: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				className={[styles.reportButton, className].filter(Boolean).join(" ")}
				onClick={() => setOpen(true)}
				aria-label="Report a problem with the field"
			>
				!
			</button>
			{open && <ReportFieldIssueDialog date={date} slot={slot} heading={heading} onClose={() => setOpen(false)} />}
		</>
	);
}

function ReportFieldIssueDialog({
	date,
	slot,
	heading,
	onClose,
}: {
	date: string;
	slot: string;
	heading: React.ReactNode;
	onClose: () => void;
}) {
	const { fieldCameras } = useAppConfig();
	const titleId = useId();
	const notesId = useId();
	const teamId = useId();
	const photosId = useId();

	const [kind, setKind] = useState<FieldIssueKind | null>(null);
	const [notes, setNotes] = useState("");
	const [team, setTeam] = useState(() =>
		typeof window === "undefined" ? "" : (localStorage.getItem("lastTeamNumber") ?? ""),
	);
	const [includeCameras, setIncludeCameras] = useState(true);
	const [photos, setPhotos] = useState<Photo[]>([]);
	const [preparing, setPreparing] = useState(0);
	const [phase, setPhase] = useState<Phase>("editing");
	const [filed, setFiled] = useState<{ issue: FieldIssue; cameras: CameraOutcome[] } | null>(null);
	const [error, setError] = useState<string | null>(null);

	const photosRef = useRef(photos);
	photosRef.current = photos;

	const reportError = api.errors.report.useMutation();
	const addIssue = api.fieldIssue.add.useMutation();

	const busy = phase === "filing" || phase === "uploading";

	// Preview URLs are browser resources; let go of them when the dialog does.
	useEffect(() => {
		return () => {
			for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
		};
	}, []);

	useEffect(() => {
		function handleEsc(event: KeyboardEvent) {
			if (event.key === "Escape" && !busy) onClose();
		}
		document.addEventListener("keydown", handleEsc);
		return () => document.removeEventListener("keydown", handleEsc);
	}, [busy, onClose]);

	const addFiles = useCallback(async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		const room = MAX_PHOTOS_PER_ISSUE - photosRef.current.length;
		const chosen = Array.from(files).slice(0, Math.max(0, room));
		if (chosen.length < files.length) setError(`A report can have at most ${MAX_PHOTOS_PER_ISSUE} photos`);
		setPreparing(n => n + chosen.length);
		for (const file of chosen) {
			const blob = await shrinkPhoto(file);
			const photo: Photo = {
				id: crypto.randomUUID(),
				blob,
				name: file.name.replace(/\.[^.]+$/, "") || "photo",
				previewUrl: URL.createObjectURL(blob),
				status: "pending",
			};
			setPhotos(prev => [...prev, photo]);
			setPreparing(n => n - 1);
		}
	}, []);

	const removePhoto = (id: string) => {
		setPhotos(prev => {
			const photo = prev.find(p => p.id === id);
			if (photo) URL.revokeObjectURL(photo.previewUrl);
			return prev.filter(p => p.id !== id);
		});
	};

	const setPhotoStatus = (id: string, status: PhotoStatus, error?: string) =>
		setPhotos(prev => prev.map(p => (p.id === id ? { ...p, status, error } : p)));

	/** Upload every photo that hasn't made it yet, one at a time. */
	const uploadPending = async (issueId: string) => {
		setPhase("uploading");
		for (const photo of photosRef.current) {
			if (photo.status === "done") continue;
			setPhotoStatus(photo.id, "uploading");
			try {
				await uploadPhoto(issueId, photo);
				setPhotoStatus(photo.id, "done");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setPhotoStatus(photo.id, "failed", message);
				if (message.startsWith("Couldn't reach"))
					reportError.mutate({ kind: "network", message, page: window.location.pathname });
			}
		}
		setPhase("done");
	};

	const info = kind ? fieldIssueKindInfo(kind) : null;
	const notesMissing = !!info?.notesRequired && !notes.trim();
	const canSubmit = !!kind && !notesMissing && !busy && preparing === 0;

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!kind || !canSubmit) return;
		setError(null);
		setPhase("filing");

		let result: { issue: FieldIssue; cameras: CameraOutcome[] };
		try {
			result = await addIssue.mutateAsync({
				kind,
				date,
				slot,
				team: team.trim() || undefined,
				notes: notes.trim() || undefined,
				captureCameras: fieldCameras.length > 0 && includeCameras,
			});
		} catch (err) {
			// The dialog stays open with everything typed, so say why rather than looking stuck.
			const { message, reachedServer } = describeRequestError(err as Parameters<typeof describeRequestError>[0]);
			setError(message);
			if (!reachedServer) reportError.mutate({ kind: "network", message: String(err), page: window.location.pathname });
			setPhase("editing");
			return;
		}

		setFiled(result);
		await uploadPending(result.issue.id);
	};

	const failedUploads = photos.filter(p => p.status === "failed").length;

	return (
		<div className={styles.overlay}>
			<div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
				<h3 id={titleId}>{phase === "done" ? "Report filed" : "Report a problem with the field"}</h3>
				<div className={styles.subheader}>{heading}</div>

				{phase === "done" && filed ? (
					<Outcome
						filed={filed}
						photos={photos}
						onRetry={() => uploadPending(filed.issue.id)}
						onClose={onClose}
						retrying={false}
					/>
				) : phase === "uploading" && filed ? (
					<Outcome filed={filed} photos={photos} onRetry={() => undefined} onClose={onClose} retrying />
				) : (
					<form onSubmit={handleSubmit}>
						{error && (
							<div className={styles.error} role="alert">
								{error}
							</div>
						)}

						<fieldset className={styles.kinds} disabled={busy}>
							<legend className={styles.label}>What's wrong?</legend>
							{FIELD_ISSUE_KINDS.map(k => (
								<label key={k.kind} className={`${styles.kind} ${kind === k.kind ? styles.kindSelected : ""}`}>
									<input
										type="radio"
										name="kind"
										value={k.kind}
										checked={kind === k.kind}
										onChange={() => setKind(k.kind)}
										className={styles.hiddenInput}
									/>
									<span className={styles.kindLabel}>{k.label}</span>
									<span className={styles.kindDescription}>{k.description}</span>
								</label>
							))}
						</fieldset>

						<div className={styles.field}>
							<label htmlFor={notesId} className={styles.label}>
								{info?.notesRequired ? "What happened?" : "Details (optional)"}
							</label>
							<textarea
								id={notesId}
								value={notes}
								onChange={event => setNotes(event.target.value)}
								rows={3}
								maxLength={2000}
								disabled={busy}
								placeholder={info ? `e.g. ${info.example}` : "e.g. Bracket on the far goal is cracked"}
							/>
						</div>

						<div className={styles.field}>
							<label htmlFor={teamId} className={styles.label}>
								Your team (optional)
							</label>
							<input
								id={teamId}
								type="text"
								inputMode="numeric"
								value={team}
								onChange={event => setTeam(event.target.value)}
								placeholder="Team number"
								disabled={busy}
							/>
						</div>

						<div className={styles.field}>
							<label htmlFor={photosId} className={styles.label}>
								Photos (optional)
							</label>
							<input
								id={photosId}
								type="file"
								accept="image/*"
								capture="environment"
								multiple
								className={styles.hiddenInput}
								disabled={busy || photos.length >= MAX_PHOTOS_PER_ISSUE}
								onChange={event => {
									void addFiles(event.target.files);
									event.target.value = "";
								}}
							/>
							<label
								htmlFor={photosId}
								className={`${styles.addPhotos} ${busy || photos.length >= MAX_PHOTOS_PER_ISSUE ? styles.addPhotosDisabled : ""}`}
							>
								📷 {photos.length === 0 ? "Take or choose photos" : "Add more"}
							</label>
							{preparing > 0 && <span className={styles.hint}>Preparing {preparing}…</span>}
							{photos.length > 0 && (
								<ul className={styles.photos}>
									{photos.map(photo => (
										<li key={photo.id} className={styles.photo}>
											{/* biome-ignore lint/performance/noImgElement: a local object URL; next/image can't optimise it */}
											<img src={photo.previewUrl} alt="" />
											<button
												type="button"
												className={styles.removePhoto}
												onClick={() => removePhoto(photo.id)}
												disabled={busy}
												aria-label="Remove this photo"
											>
												×
											</button>
										</li>
									))}
								</ul>
							)}
						</div>

						{fieldCameras.length > 0 && (
							<label className={styles.cameras}>
								<input
									type="checkbox"
									checked={includeCameras}
									onChange={event => setIncludeCameras(event.target.checked)}
									disabled={busy}
								/>
								<span>
									Include a frame from the shop camera{fieldCameras.length === 1 ? "" : "s"} ({fieldCameras.join(", ")})
								</span>
							</label>
						)}

						<div className={styles.actions}>
							<button type="submit" disabled={!canSubmit}>
								{phase === "filing" ? "Filing…" : "File report"}
							</button>
							<button type="button" onClick={onClose} disabled={busy}>
								Cancel
							</button>
						</div>
					</form>
				)}

				{phase === "done" && failedUploads > 0 && (
					<p className={styles.hint}>
						{failedUploads === 1 ? "One photo" : `${failedUploads} photos`} didn't upload. The report is filed either
						way.
					</p>
				)}
			</div>
		</div>
	);
}

/** What happened to the report, each camera and each photo, once filing has begun. */
function Outcome({
	filed,
	photos,
	onRetry,
	onClose,
	retrying,
}: {
	filed: { issue: FieldIssue; cameras: CameraOutcome[] };
	photos: Photo[];
	onRetry: () => void;
	onClose: () => void;
	retrying: boolean;
}) {
	const failed = photos.some(p => p.status === "failed");
	const uploading = photos.some(p => p.status === "uploading" || p.status === "pending");

	return (
		<div className={styles.outcome}>
			<p>
				Thanks. Your <strong>{fieldIssueKindInfo(filed.issue.kind).label.toLowerCase()}</strong> report is filed
				{filed.issue.team ? ` for team ${filed.issue.team}` : ""}.
			</p>

			{filed.cameras.length > 0 && (
				<ul className={styles.outcomeList}>
					{filed.cameras.map(c => (
						<li key={c.camera} className={c.ok ? styles.ok : styles.failed}>
							{c.ok ? "✓" : "✗"} {c.camera} camera{c.ok ? "" : `: ${c.error}`}
						</li>
					))}
				</ul>
			)}

			{photos.length > 0 && (
				<ul className={styles.photos}>
					{photos.map(photo => (
						<li key={photo.id} className={`${styles.photo} ${styles[`photo_${photo.status}`] ?? ""}`}>
							{/* biome-ignore lint/performance/noImgElement: a local object URL; next/image can't optimise it */}
							<img src={photo.previewUrl} alt="" />
							<span className={styles.photoStatus}>
								{photo.status === "done"
									? "✓"
									: photo.status === "failed"
										? "✗"
										: photo.status === "uploading"
											? "…"
											: ""}
							</span>
							{photo.error && <span className={styles.photoError}>{photo.error}</span>}
						</li>
					))}
				</ul>
			)}

			<div className={styles.actions}>
				{failed && !uploading && (
					<button type="button" onClick={onRetry} disabled={retrying}>
						Retry upload
					</button>
				)}
				<button type="button" onClick={onClose} disabled={uploading}>
					{uploading ? "Uploading…" : "Close"}
				</button>
			</div>
		</div>
	);
}
