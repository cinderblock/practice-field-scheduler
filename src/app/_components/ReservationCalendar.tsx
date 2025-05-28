"use client";

import styles from "../index.module.css";
import { useInterval } from "./useInterval";
import { api } from "~/trpc/react";
import { useState } from "react";
import type { Reservation } from "~/types";

const TimeSlotBorders = [-2, 1, 4, 7, 10]; // Relative to noon
const ReservationDays = 7;
const TimeZone = "America/Los_Angeles";

type InitialReservations = {
	date: string;
	reservations: Reservation[];
}[];

/**
 * Returns the current date in the fixed timezone
 * @returns The current date in the fixed timezone
 */
function getToday(): string {
	return new Date().toLocaleDateString("en-CA", { timeZone: TimeZone });
}

/**
 * Returns the time zone name for a given date and time
 * @example assuming TimeZone is "America/Los_Angeles"
 * getTimeZoneName("2024-01-01") // "PST"
 * getTimeZoneName("2024-06-01") // "PDT"
 *
 * @param date - The date to get the time zone name for
 * @param time - The time to get the time zone name for
 * @returns The time zone name for the given date and time
 */
function getTimeZoneName(date: string, time = "00:00"): string {
	const testDate = new Date(`${date}T12:00:00`);
	const formatter = new Intl.DateTimeFormat("en", {
		timeZone: TimeZone,
		timeZoneName: "short",
	});
	const timeZoneName = formatter.formatToParts(testDate).find(part => part.type === "timeZoneName")?.value;

	if (!timeZoneName) throw new Error("Failed to get time zone name");

	return timeZoneName;
}

function createDateFromStrings(date: string, time: string | number = "00:00"): Date {
	if (typeof time === "number") time = `${time.toString().padStart(2, "0")}:00`;

	const timeZoneName = getTimeZoneName(date, time);

	// Parse the actual datetime with the correct timezone abbreviation
	return new Date(`${date} ${time} ${timeZoneName}`);
}

function TimeDisplay({ hour, minute }: { date: string; hour: number; minute?: number }) {
	let mins = minute?.toString().padStart(2, "0");
	if (minute === undefined) mins = "";
	else mins = `:${mins}`;

	const am_pm = hour < 12 ? "am" : "pm";
	if (hour > 12) hour -= 12;

	return <>{`${hour}${mins}${am_pm}`}</>;
}

function TimeRangeDisplay({ date, start, end }: { date: string; start: number; end: number }) {
	return (
		<span className={styles.timeSlotTime}>
			<TimeDisplay date={date} hour={start} /> - <TimeDisplay date={date} hour={end} />
		</span>
	);
}
function getWeekdayFromDateString(date: string): string {
	return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" });
}

function isWeekend(date: string): boolean {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "short",
	});
	return formatter.format(new Date(`${date}T12:00:00`)).startsWith("S");
}

function DayName({ date }: { date: string }) {
	const dayString = getWeekdayFromDateString(date);

	// Calculate days difference
	const today = useInterval(getToday, 1000);
	const diffDays = getDateDaysDifference(date, today);

	let dayLabel = "";
	if (diffDays === 0) dayLabel = "(today)";
	else if (diffDays === 1) dayLabel = "(tomorrow)";
	else if (diffDays > 1) dayLabel = `(in ${diffDays} days)`;

	return (
		<span className={styles.dayName} style={{ whiteSpace: "nowrap" }}>
			{dayString}
			{dayLabel && (
				<span className={styles.dayLabel} style={{ userSelect: "none" }}>
					{dayLabel}
				</span>
			)}
		</span>
	);
}

function DayDate({ date }: { date: string }) {
	return <span className={styles.dayDate}>{date}</span>;
}

function addDaysToDateString(date: string, days: number): string {
	const d = new Date(`${date}T12:00:00`);
	d.setDate(d.getDate() + days);
	return d.toISOString().slice(0, 10);
}

function getDateDaysDifference(from: string, until: string): number {
	const a = new Date(`${until}T12:00:00`);
	const b = new Date(`${from}T12:00:00`);
	const delta = b.getTime() - a.getTime();
	const day = 1000 * 60 * 60 * 24;
	return Math.round(delta / day);
}

function hourToTimeSlot(hour: number, minute = 0): string {
	const am_pm = hour < 12 ? "am" : "pm";
	if (hour > 12) hour -= 12;
	return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}${am_pm}`;
}

function pluralize(count: number, singular = "", plural = `${singular}s`) {
	return count === 1 ? singular : plural;
}

export function ReservationCalendar({
	initialReservations,
}: {
	initialReservations: InitialReservations;
}) {
	const startDate = useInterval(() => {
		const today = getToday();

		const lastTimeSlot = TimeSlotBorders[TimeSlotBorders.length - 1];
		if (lastTimeSlot === undefined) throw new Error("TimeSlotBorders is empty");

		const lastEventToday = createDateFromStrings(today, lastTimeSlot + 12);

		// Start tomorrow after the last time slot of the day
		if (new Date() >= lastEventToday) return addDaysToDateString(today, 1);

		return today;
	});

	const daysText = `${ReservationDays} ${pluralize(ReservationDays, "day")}`;

	return (
		<>
			<div className={styles.calendarGrid}>
				<Days start={startDate} days={ReservationDays + 1} initialReservations={initialReservations} />
			</div>
			<p>
				We only allow reservations for the next {daysText}.
				<br />
				Please check back later for more availability.
			</p>
		</>
	);
}

function Days({
	start,
	days,
	initialReservations,
}: {
	start: string;
	days: number;
	initialReservations: InitialReservations;
}) {
	const dates = Array.from({ length: days }, (_, i) => addDaysToDateString(start, i));

	return (
		<>
			{dates.map(date => (
				<div key={date} className={styles.calendarDay}>
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
	date: string;
	initialReservations: InitialReservations;
}) {
	const style = [styles.dayContainer];
	if (isWeekend(date)) style.push(styles.weekend);

	return (
		<div className={style.join(" ")}>
			<div className={styles.dayHeader}>
				<DayName date={date} />
				<DayDate date={date} />
			</div>
			<div className={styles.timeSlotRow}>
				{TimeSlotBorders.map((_, index, a) => {
					if (index === a.length - 1) return null;

					const startHours = a[index];
					const endHours = a[index + 1];
					if (startHours === undefined || endHours === undefined) throw new Error("TimeSlotBorders is empty");

					const startHour = 12 + startHours;
					const endHour = 12 + endHours;

					return (
						<TimeSlot
							key={`${date}_${startHour}`}
							date={date}
							startHour={startHour}
							endHour={endHour}
							initialReservations={initialReservations}
						/>
					);
				})}
			</div>
		</div>
	);
}

function TimeSlot({
	date,
	startHour,
	endHour,
	initialReservations,
}: {
	date: string;
	startHour: number;
	endHour: number;
	initialReservations: InitialReservations;
}) {
	const [isAdding, setIsAdding] = useState(false);
	const [teamNumber, setTeamNumber] = useState("");
	const [priority, setPriority] = useState(false);
	const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
	const [tempTeamNumber, setTempTeamNumber] = useState<string | null>(null);
	const utils = api.useUtils();

	const slot = hourToTimeSlot(startHour);

	// Calculate days difference
	const today = useInterval(getToday, 1000);
	const diffDays = getDateDaysDifference(date, today);

	let dayLabel = "";
	if (diffDays === 0) dayLabel = "(today)";
	else if (diffDays === 1) dayLabel = "(tomorrow)";
	else if (diffDays > 1) dayLabel = `(in ${diffDays} days)`;

	const initialData = initialReservations.find(r => r.date === date)?.reservations ?? [];

	const { data: reservations = initialData } = api.reservation.list.useQuery(
		{
			date: date,
		},
		{
			initialData,
		},
	);

	if (!Array.isArray(reservations)) {
		throw new Error("reservations is not an array");
	}

	// Filter reservations for this specific time slot
	const slotReservations = reservations.filter(r => r.slot === slot);

	const addReservation = api.reservation.add.useMutation({
		onMutate: async newReservation => {
			// Cancel any outgoing refetches
			await utils.reservation.list.cancel();

			// Get the current data for the affected date
			const previousData = utils.reservation.list.getData({ date });

			// Optimistically update the cache
			utils.reservation.list.setData({ date }, old => {
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
			utils.reservation.list.setData({ date }, old => {
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
				utils.reservation.list.setData({ date }, context.previousData);
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
			const previousData = utils.reservation.list.getData({ date });

			// Mark the reservation as pending deletion in local state
			setPendingDeletions(prev => new Set([...prev, id]));

			return { previousData };
		},
		onSuccess: (data, { id }) => {
			// Now remove it from the cache
			utils.reservation.list.setData({ date }, old => {
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
				utils.reservation.list.setData({ date }, context.previousData);
			}
			// Remove from pending deletions
			setPendingDeletions(prev => {
				const next = new Set(prev);
				next.delete(variables.id);
				return next;
			});
		},
	});

	// Create Date objects for time comparisons using lab timezone
	const startTime = createDateFromStrings(date, startHour);
	const endTime = createDateFromStrings(date, endHour);

	const hasStarted = useInterval(() => new Date() >= startTime, 1000, [startTime]);
	const hasEnded = useInterval(() => new Date() >= endTime, 1000, [endTime]);

	const current = hasStarted && !hasEnded;

	const style = [styles.timeSlotStackContainer];
	if (current) style.push(styles.timeSlotCurrent);
	if (hasEnded) style.push(styles.timeSlotOver);

	const handleAddReservation = () => {
		if (!teamNumber) return;
		// Don't clear tempTeamNumber here - let the optimistic update handle it
		addReservation.mutate({
			date: date,
			slot: slot,
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
			<TimeRangeDisplay date={date} start={startHour} end={endHour} />
			<div className={styles.reservationStack}>
				{/* Existing reservations */}
				{slotReservations.map(r => (
					<div
						key={r.id}
						className={`${styles.reservationPill} ${
							pendingDeletions.has(r.id) ? styles.pendingDeletion : ""
						} ${r.id === "temp-id" ? styles.pendingAddition : ""}`}
					>
						{r.team}
						<button
							style={{ userSelect: "none" }}
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
				{/* Pending addition */}
				{tempTeamNumber !== null && isAdding && (
					<div className={`${styles.reservationPill} ${styles.pendingAddition}`}>
						<span style={{ userSelect: "none" }}>{tempTeamNumber || "New Team"}</span>
						<button type="button" onClick={handleCancelAdd} className={styles.removeReservationBtn}>
							×
						</button>
					</div>
				)}
			</div>
			{/* Add reservation button */}
			{!hasEnded && (
				<button
					style={{ userSelect: "none" }}
					type="button"
					className={styles.addReservationBtn}
					onClick={handleOpenAddModal}
				>
					+
				</button>
			)}
			{/* Add reservation modal */}
			{isAdding && (
				<div className={styles.addReservationModal}>
					<div className={styles.modalContent}>
						<h3>Add Reservation</h3>
						<div className={styles.modalSubheader}>
							<DayName date={date} />
							<DayDate date={date} />
							<TimeRangeDisplay date={date} start={startHour} end={endHour} />
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
