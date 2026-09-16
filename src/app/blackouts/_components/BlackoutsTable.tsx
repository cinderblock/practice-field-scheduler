"use client";

import { useMemo, useState } from "react";
import { useInterval } from "~/app/_components/useInterval";
import { env } from "~/env";
import { blackoutDayCount, blackoutEndDate, formatBlackoutDates } from "~/server/util/blackout";
import { getTimeSlots } from "~/server/util/timeSlots";
import { api } from "~/trpc/react";
import type { Blackout, Reservation } from "~/types";
import styles from "./BlackoutsTable.module.css";

const TimeZone = env.NEXT_PUBLIC_TIME_ZONE;

/** Whole-day blackouts are stored with no slot; the form needs a value to put in the <select>. */
const AllDay = "all-day";

function formatHour(hour: number): string {
	const whole = Math.floor(hour);
	const minutes = Math.round((hour - whole) * 60);
	const amPm = whole < 12 ? "am" : "pm";
	const display = whole > 12 ? whole - 12 : whole;
	return `${display}${minutes ? `:${minutes.toString().padStart(2, "0")}` : ""}${amPm}`;
}

/** Today's date in the field's timezone, so "past" means past where the field actually is. */
function getToday(): string {
	return new Date().toLocaleDateString("en-CA", { timeZone: TimeZone });
}

type NewBlackout = {
	date: string;
	endDate: string;
	slot: string;
	reason: string;
};

const emptyBlackout: NewBlackout = { date: "", endDate: "", slot: AllDay, reason: "" };

export function BlackoutsTable({ blackouts: initialBlackouts }: { blackouts: Blackout[] }) {
	const [isAdding, setIsAdding] = useState(false);
	const [isRange, setIsRange] = useState(false);
	const [draft, setDraft] = useState<NewBlackout>(emptyBlackout);
	const [conflicts, setConflicts] = useState<Reservation[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const slots = useMemo(() => getTimeSlots(), []);

	const utils = api.useUtils();
	const { data: blackouts = initialBlackouts } = api.blackout.list.useQuery(undefined, {
		initialData: initialBlackouts,
	});

	const resetForm = () => {
		setIsAdding(false);
		setIsRange(false);
		setDraft(emptyBlackout);
		setError(null);
	};

	const addBlackout = api.blackout.add.useMutation({
		onSuccess: ({ conflicts }) => {
			utils.blackout.list.invalidate();
			// The calendar's reservation queries now have a stale view of what's bookable
			utils.reservation.list.invalidate();
			setConflicts(conflicts.length ? conflicts : null);
			resetForm();
		},
		onError: err => setError(err.message),
	});

	const removeBlackout = api.blackout.remove.useMutation({
		onSuccess: () => {
			utils.blackout.list.invalidate();
			utils.reservation.list.invalidate();
		},
		onError: err => setError(err.message),
	});

	const year = new Date().getFullYear();
	const minDate = `${year}-01-01`;
	const maxDate = `${year}-12-31`;

	const rangeIsBackwards = isRange && !!draft.endDate && draft.endDate < draft.date;
	const canSubmit = !!draft.date && !rangeIsBackwards && (!isRange || !!draft.endDate);

	const handleAdd = () => {
		if (!canSubmit) return;
		setError(null);
		setConflicts(null);

		addBlackout.mutate({
			date: draft.date,
			endDate: isRange && draft.endDate ? draft.endDate : undefined,
			slot: draft.slot === AllDay ? undefined : draft.slot,
			reason: draft.reason.trim() || undefined,
		});
	};

	const handleRemove = (blackout: Blackout) => {
		const span = formatBlackoutDates(blackout);
		if (!confirm(`Remove the blackout for ${span}? The field becomes bookable again.`)) return;
		setError(null);
		removeBlackout.mutate({ id: blackout.id });
	};

	const describeScope = (blackout: Blackout) => {
		if (!blackout.slot) return "Entire day";
		const match = slots.find(s => s.slot === blackout.slot);
		return match ? `${formatHour(match.startHour)} – ${formatHour(match.endHour)}` : blackout.slot;
	};

	// Re-evaluated on a timer so a blackout moves to "Past" at midnight without a reload
	const now = useInterval(getToday, 60_000);
	const sorted = [...blackouts].sort((a, b) => a.date.localeCompare(b.date));
	const current = sorted.filter(b => blackoutEndDate(b) >= now);
	const past = sorted.filter(b => blackoutEndDate(b) < now).reverse();

	const renderCard = (blackout: Blackout, isPast: boolean) => {
		const days = blackoutDayCount(blackout);

		return (
			<div key={blackout.id} className={`${styles.card} ${isPast ? styles.pastCard : ""}`}>
				<div className={styles.cardInfo}>
					<div className={styles.cardDates}>{formatBlackoutDates(blackout)}</div>
					<div className={styles.cardMeta}>
						<span className={styles.chip}>{describeScope(blackout)}</span>
						{days > 1 && <span className={styles.chip}>{days} days</span>}
					</div>
					{blackout.reason ? (
						<div className={styles.cardReason}>{blackout.reason}</div>
					) : (
						<div className={styles.cardNoReason}>No reason given</div>
					)}
				</div>
				<button
					type="button"
					className={styles.removeButton}
					onClick={() => handleRemove(blackout)}
					disabled={removeBlackout.isPending}
					aria-label={`Remove blackout for ${formatBlackoutDates(blackout)}`}
				>
					Remove
				</button>
			</div>
		);
	};

	return (
		<div className={styles.container}>
			<div className={styles.header}>
				<h2>Manage Blackouts</h2>
				<button
					type="button"
					className={styles.addButton}
					onClick={() => (isAdding ? resetForm() : setIsAdding(true))}
					disabled={addBlackout.isPending}
				>
					{isAdding ? "Cancel" : "Add Blackout"}
				</button>
			</div>

			<p className={styles.intro}>
				A blackout closes the practice field. Teams cannot book any slot it covers, and it shows on the calendar and in
				the subscribed calendar feeds. Admins are exempt and can still book over a blackout.
			</p>

			{error && <div className={styles.error}>{error}</div>}

			{conflicts && (
				<div className={styles.warning}>
					<div className={styles.warningTitle}>
						{conflicts.length} existing {conflicts.length === 1 ? "reservation falls" : "reservations fall"} inside this
						blackout
					</div>
					<p>
						They were <strong>not</strong> cancelled. Contact the teams, then remove the reservations from the calendar
						if they can&apos;t go ahead.
					</p>
					<ul className={styles.conflictList}>
						{conflicts.map(r => (
							<li key={r.id}>
								Team {r.team} — {r.date} at {r.slot}
							</li>
						))}
					</ul>
					<button type="button" className={styles.cancelButton} onClick={() => setConflicts(null)}>
						Dismiss
					</button>
				</div>
			)}

			{isAdding && (
				<div className={styles.addForm}>
					<h3>Add New Blackout</h3>

					<div className={styles.formRow}>
						<label htmlFor="blackout-date">{isRange ? "First day" : "Date"}</label>
						<input
							id="blackout-date"
							type="date"
							value={draft.date}
							onChange={e => setDraft(prev => ({ ...prev, date: e.target.value }))}
							min={minDate}
							max={maxDate}
						/>
						<span className={styles.hint}>Blackouts can only be set within {year}.</span>
					</div>

					<div className={styles.formRow}>
						<label className={styles.checkboxLabel}>
							<input
								type="checkbox"
								checked={isRange}
								onChange={e => {
									setIsRange(e.target.checked);
									if (!e.target.checked) setDraft(prev => ({ ...prev, endDate: "" }));
								}}
							/>
							<span>Spans multiple days</span>
						</label>
					</div>

					{isRange && (
						<div className={styles.formRow}>
							<label htmlFor="blackout-end-date">Last day</label>
							<input
								id="blackout-end-date"
								type="date"
								value={draft.endDate}
								onChange={e => setDraft(prev => ({ ...prev, endDate: e.target.value }))}
								min={draft.date || minDate}
								max={maxDate}
							/>
							<span className={styles.hint}>Both the first and last day are included in the blackout.</span>
							{rangeIsBackwards && <span className={styles.fieldError}>The last day is before the first day.</span>}
						</div>
					)}

					<div className={styles.formRow}>
						<label htmlFor="blackout-slot">Applies to</label>
						<select
							id="blackout-slot"
							value={draft.slot}
							onChange={e => setDraft(prev => ({ ...prev, slot: e.target.value }))}
						>
							<option value={AllDay}>Entire day (every time slot)</option>
							{slots.map(s => (
								<option key={s.slot} value={s.slot}>
									{formatHour(s.startHour)} – {formatHour(s.endHour)}
								</option>
							))}
						</select>
						<span className={styles.hint}>
							Pick a single time slot to close only part of {isRange ? "each day" : "the day"}.
						</span>
					</div>

					<div className={styles.formRow}>
						<label htmlFor="blackout-reason">Reason (optional)</label>
						<input
							id="blackout-reason"
							type="text"
							value={draft.reason}
							onChange={e => setDraft(prev => ({ ...prev, reason: e.target.value }))}
							placeholder="e.g., Field resurfacing"
							maxLength={200}
						/>
						<span className={styles.hint}>Shown to teams on the calendar, so keep it self-explanatory.</span>
					</div>

					<div className={styles.formActions}>
						<button
							type="button"
							className={styles.saveButton}
							onClick={handleAdd}
							disabled={addBlackout.isPending || !canSubmit}
						>
							{addBlackout.isPending ? "Adding..." : "Add Blackout"}
						</button>
						<button type="button" className={styles.cancelButton} onClick={resetForm}>
							Cancel
						</button>
					</div>
				</div>
			)}

			<div className={styles.list}>
				<h3>Current &amp; Upcoming</h3>
				{current.length === 0 ? (
					<p className={styles.emptyMessage}>No blackouts scheduled. The field is open on every day shown.</p>
				) : (
					<div className={styles.grid}>{current.map(b => renderCard(b, false))}</div>
				)}
			</div>

			{past.length > 0 && (
				<div className={styles.list}>
					<h3>Past</h3>
					<div className={styles.grid}>{past.map(b => renderCard(b, true))}</div>
				</div>
			)}
		</div>
	);
}
