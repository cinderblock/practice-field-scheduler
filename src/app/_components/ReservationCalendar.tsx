"use client";

import styles from "../index.module.css";
import { useInterval } from "./useInterval";
import { api } from "~/trpc/react";
import { useState } from "react";
import type { Reservation } from "~/types";
import { dateToDateString, dateToTime, dateToTimeSlotString } from "~/server/util/timeUtils";

const TimeSlotBorders = [-2, 1, 4, 7, 10]; // Relative to noon
const ReservationDays = 7;
const TimeZone = "America/Los_Angeles";

type InitialReservations = {
	date: string;
	reservations: Reservation[];
}[];

function pluralize(count: number, singular = "", plural = `${singular}s`) {
	return count === 1 ? singular : plural;
}

export function ReservationCalendar({
	initialReservations,
}: {
	initialReservations: InitialReservations;
}) {
	const start = useInterval(() => {
		const now = new Date();
		const lastTimeSlot = TimeSlotBorders[TimeSlotBorders.length - 1];
		if (lastTimeSlot === undefined) throw new Error("TimeSlotBorders is empty");

		// Add 12 because time slots are relative to noon
		if (now.getHours() >= 12 + lastTimeSlot) {
			// Start tomorrow after the last time slot of the day
			now.setDate(now.getDate() + 1);
		}

		// Set time to local midnight
		now.setHours(0, 0, 0, 0);

		return now.getTime();
	});

	const daysText = `${ReservationDays} ${pluralize(ReservationDays, "day")}`;

	return (
		TimeZoneAlert() ?? (
			<>
				<div className={styles.calendarGrid}>
					<Days start={new Date(start)} days={ReservationDays + 1} initialReservations={initialReservations} />
				</div>
				<p>
					We only allow reservations for the next {daysText}.
					<br />
					Please check back later for more availability.
				</p>
			</>
		)
	);
}

function useTimezone() {
	return useInterval(() => Intl.DateTimeFormat().resolvedOptions().timeZone, 500);
}

// Check if client's timezone is not the same as the server's and show a warning
function TimeZoneAlert() {
	const renderTimeZone = useTimezone();

	if (renderTimeZone === TimeZone) return null;

	return (
		<div className={styles.timezoneAlert}>
			<p>Your timezone is different from the lab's.</p>
			<p>Contact the admin if you need support for this.</p>
		</div>
	);
}

function Days({
	start,
	days,
	initialReservations,
}: {
	start: Date;
	days: number;
	initialReservations: InitialReservations;
}) {
	const dates = Array.from({ length: days }, (_, i) => {
		const date = new Date(start);
		date.setDate(start.getDate() + i);
		return date;
	});

	return (
		<>
			{dates.map(date => (
				<div key={date.getTime()} className={styles.calendarDay}>
					<Day date={date} initialReservations={initialReservations} />
				</div>
			))}
		</>
	);
}

function Day({
	date,
	initialReservations,
}: {
	date: Date;
	initialReservations: InitialReservations;
}) {
	const dateString = date.toISOString().slice(0, 10);
	const dayString = date.toLocaleDateString(undefined, { weekday: "long" });

	// Calculate days difference
	const today = useInterval(() => {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		return now.getTime();
	}, 1000);

	const diffDays = Math.round((date.getTime() - today) / (1000 * 60 * 60 * 24));
	let dayLabel = "";
	if (diffDays === 0) dayLabel = "(today)";
	else if (diffDays === 1) dayLabel = "(tomorrow)";
	else if (diffDays > 1) dayLabel = `(in ${diffDays} days)`;

	const isWeekend = date.getDay() === 0 || date.getDay() === 6;

	return (
		<div className={isWeekend ? `${styles.dayContainer} ${styles.weekend}` : styles.dayContainer}>
			<div className={styles.dayHeader}>
				<span className={styles.dayName}>
					{dayString} {dayLabel && <span className={styles.dayLabel}>{dayLabel}</span>}
				</span>
				<span className={styles.dayDate}>{dateString}</span>
			</div>
			<div className={styles.timeSlotRow}>
				{TimeSlotBorders.map((_, index, a) => {
					if (index === a.length - 1) return null;
					const start = new Date(date);
					const end = new Date(date);

					const startHours = a[index];
					const endHours = a[index + 1];
					if (startHours === undefined || endHours === undefined) throw new Error("TimeSlotBorders is empty");

					start.setHours(12 + startHours, 0, 0, 0);
					end.setHours(12 + endHours, 0, 0, 0);

					return (
						<TimeSlot
							key={dateToTimeSlotString(start)}
							start={start}
							end={end}
							initialReservations={initialReservations}
						/>
					);
				})}
			</div>
		</div>
	);
}

function TimeSlot({
	start,
	end,
	initialReservations,
}: {
	start: Date;
	end: Date;
	initialReservations: InitialReservations;
}) {
	const [isAdding, setIsAdding] = useState(false);
	const [teamNumber, setTeamNumber] = useState("");
	const [priority, setPriority] = useState(false);
	const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
	const [tempTeamNumber, setTempTeamNumber] = useState<string | null>(null);
	const utils = api.useUtils();

	const dateStr = dateToDateString(start);
	const slotStr = dateToTime(start);
	const dayString = start.toLocaleDateString(undefined, { weekday: "long" });

	// Calculate days difference
	const today = useInterval(() => {
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		return now.getTime();
	}, 1000);

	const diffDays = Math.round((start.getTime() - today) / (1000 * 60 * 60 * 24));
	let dayLabel = "";
	if (diffDays === 0) dayLabel = "(today)";
	else if (diffDays === 1) dayLabel = "(tomorrow)";
	else if (diffDays > 1) dayLabel = `(in ${diffDays} days)`;

	const isWeekend = start.getDay() === 0 || start.getDay() === 6;

	const initialData = initialReservations.find(r => r.date === dateStr)?.reservations ?? [];

	const { data: reservations = initialData } = api.reservation.list.useQuery(
		{
			date: dateStr,
		},
		{
			initialData,
		},
	);

	if (!Array.isArray(reservations)) {
		throw new Error("reservations is not an array");
	}

	// Filter reservations for this specific time slot
	const slotReservations = reservations.filter(r => r.slot === slotStr);

	const addReservation = api.reservation.add.useMutation({
		onMutate: async newReservation => {
			// Cancel any outgoing refetches
			await utils.reservation.list.cancel();

			// Get the current data for the affected date
			const previousData = utils.reservation.list.getData({ date: dateStr });

			// Optimistically update the cache
			utils.reservation.list.setData({ date: dateStr }, old => {
				if (!old) return [];
				if (!Array.isArray(old)) return [];
				return [
					...old,
					{
						...newReservation,
						id: "temp-id",
						created: new Date(),
						userId: "temp-user",
						priority: newReservation.priority, // Include the priority in the optimistic update
					},
				];
			});

			// Clear the temporary team number after the optimistic update
			setTempTeamNumber(null);

			return { previousData };
		},
		onSuccess: ({ reservation }) => {
			// Update the cache with the real reservation from the server
			utils.reservation.list.setData({ date: dateStr }, old => {
				if (!old) return [];
				if (!Array.isArray(old)) return [];
				// Replace the temp reservation with the real one
				return old.map(r => (r.id === "temp-id" ? reservation : r));
			});
			setIsAdding(false);
			setTeamNumber("");
		},
		onError: (err, newReservation, context) => {
			// Rollback on error
			if (context?.previousData) {
				utils.reservation.list.setData({ date: dateStr }, context.previousData);
			}
			// Restore the temporary team number on error
			setTempTeamNumber(newReservation.team);
		},
		onSettled: () => {
			// Don't refetch
		},
	});

	const removeReservation = api.reservation.remove.useMutation({
		onMutate: async ({ id }) => {
			// Cancel any outgoing refetches
			await utils.reservation.list.cancel();

			// Get the current data for the affected date
			const previousData = utils.reservation.list.getData({ date: dateStr });

			// Mark the reservation as pending deletion in local state
			setPendingDeletions(prev => new Set([...prev, id]));

			return { previousData };
		},
		onSuccess: (data, { id }) => {
			// Now remove it from the cache
			utils.reservation.list.setData({ date: dateStr }, old => {
				if (!old) return [];
				if (!Array.isArray(old)) return [];
				return old.filter(r => r.id !== id);
			});
			// Remove from pending deletions
			setPendingDeletions(prev => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
		},
		onError: (err, variables, context) => {
			// Rollback on error
			if (context?.previousData) {
				utils.reservation.list.setData({ date: dateStr }, context.previousData);
			}
			// Remove from pending deletions
			setPendingDeletions(prev => {
				const next = new Set(prev);
				next.delete(variables.id);
				return next;
			});
		},
	});

	const hasStarted = useInterval(() => new Date() >= start, 1000, [start]);
	const hasEnded = useInterval(() => new Date() >= end, 1000, [end]);

	const current = hasStarted && !hasEnded;

	const style = [styles.timeSlotStackContainer];
	if (current) style.push(styles.timeSlotCurrent);
	if (hasEnded) style.push(styles.timeSlotOver);

	const handleAddReservation = () => {
		if (!teamNumber) return;
		// Don't clear tempTeamNumber here - let the optimistic update handle it
		addReservation.mutate({
			date: dateStr,
			slot: slotStr,
			team: teamNumber,
			notes: "",
			priority,
		});
	};

	const handleOpenAddModal = () => {
		setIsAdding(true);
		setTempTeamNumber(""); // Start with empty temporary pill
		setPriority(false); // Reset priority when opening modal
	};

	const handleCancelAdd = () => {
		setIsAdding(false);
		setTeamNumber("");
		setPriority(false);
		setTempTeamNumber(null);
	};

	return (
		<div className={style.join(" ")}>
			<div className={styles.timeSlotTime}>
				{dateToTime(start)} - {dateToTime(end)}
			</div>
			<div className={styles.reservationStack}>
				{slotReservations.map(r => (
					<div
						key={r.id}
						className={`${styles.reservationPill} ${
							pendingDeletions.has(r.id) ? styles.pendingDeletion : ""
						} ${r.id === "temp-id" ? styles.pendingAddition : ""}`}
					>
						{r.team}
						<button
							type="button"
							onClick={() => {
								console.log("Removing reservation:", {
									id: r.id,
								});
								removeReservation.mutate({
									id: r.id,
								});
							}}
							className={styles.removeReservationBtn}
							disabled={pendingDeletions.has(r.id)}
						>
							{pendingDeletions.has(r.id) ? "⌛" : "×"}
						</button>
					</div>
				))}
				{tempTeamNumber !== null && isAdding && (
					<div className={`${styles.reservationPill} ${styles.pendingAddition}`}>
						{tempTeamNumber || "New Team"}
						<button type="button" onClick={handleCancelAdd} className={styles.removeReservationBtn}>
							×
						</button>
					</div>
				)}
			</div>
			{!hasEnded && (
				<button type="button" className={styles.addReservationBtn} onClick={handleOpenAddModal}>
					+
				</button>
			)}
			{isAdding && (
				<div className={styles.addReservationModal}>
					<div className={styles.modalContent}>
						<h3>Add Reservation</h3>
						<div className={styles.modalSubheader}>
							<span className={styles.dayName}>
								{dayString} {dayLabel && <span className={styles.dayLabel}>{dayLabel}</span>}
							</span>
							<span className={styles.dayDate}>{dateStr}</span>
							<span className={styles.timeSlotTime}>
								{dateToTime(start)} - {dateToTime(end)}
							</span>
						</div>
						<form
							onSubmit={e => {
								e.preventDefault();
								handleAddReservation();
							}}
						>
							<div className={styles.formGroup}>
								<label className={styles.checkboxLabel}>
									<input
										type="checkbox"
										checked={priority}
										onChange={e => setPriority(e.target.checked)}
										className={styles.hiddenCheckbox}
									/>
									<span className={styles.checkboxEmoji}>{priority ? "✔️" : ""}</span>
									<span className={styles.checkboxText}>Prioritize</span>
								</label>
							</div>
							<div className={styles.formGroup}>
								<input
									type="text"
									id="teamNumber"
									value={teamNumber}
									onChange={e => {
										setTeamNumber(e.target.value);
										setTempTeamNumber(e.target.value);
									}}
									placeholder="Enter team number"
								/>
							</div>
							<div className={styles.modalActions}>
								<button type="submit" disabled={!teamNumber}>
									Add
								</button>
								<button type="button" onClick={handleCancelAdd}>
									Cancel
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}
