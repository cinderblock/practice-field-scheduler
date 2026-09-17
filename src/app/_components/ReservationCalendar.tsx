"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findBlackoutForSlot, isWholeDayBlackedOut } from "~/server/util/blackout";
import { createDateFromDateStringHour, hourToTimeSlot } from "~/server/util/timeSlots";
import { api } from "~/trpc/react";
import type { Blackout, Holiday, Reservation, WeatherForecast } from "~/types";
import styles from "../index.module.css";
import { useAppConfig } from "./AppConfig";
import { DayWeather } from "./DayWeather";
import { useHistory } from "./HistoryContext";
import { TeamAvatar } from "./TeamAvatar";
import { useInterval } from "./useInterval";

type InitialReservations = {
	date: string;
	reservations: Reservation[];
}[];

/**
 * Returns the current date in the field's timezone
 * @returns The current date in the field's timezone
 */
function getToday(timeZone: string): string {
	return new Date().toLocaleDateString("en-CA", { timeZone });
}

function TimeDisplay({ hour, minute }: { date: string; hour: number; minute?: number }) {
	// Move fractional hours to minutes
	if (Math.floor(hour) !== hour) {
		if (minute === undefined) minute = 0;

		minute += (hour - Math.floor(hour)) * 60;

		hour = Math.floor(hour);
	}

	// Handle minute overflow
	if (minute !== undefined) {
		if (minute > 60) {
			hour += Math.floor(minute / 60);
			minute = minute % 60;
		}
		minute = Math.floor(minute);
	}

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
	const { timeZone } = useAppConfig();
	const dayString = getWeekdayFromDateString(date);

	// Calculate days difference
	const today = useInterval(() => getToday(timeZone), 1000, [timeZone]);
	const diffDays = getDateDaysDifference(date, today);

	let dayLabel = "";
	if (diffDays === 0) dayLabel = "(today)";
	else if (diffDays === 1) dayLabel = "(tomorrow)";
	else if (diffDays > 1) dayLabel = `(in ${diffDays} days)`;
	else if (diffDays === -1) dayLabel = "(yesterday)";
	else if (diffDays < -1) dayLabel = `(${Math.abs(diffDays)} days ago)`;

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

function DayDate({ date, holidays }: { date: string; holidays: Holiday[] }) {
	// Find holidays for this date
	const dayHolidays = holidays.filter(holiday => holiday.date === date);

	return (
		<span className={styles.dayDate}>
			{dayHolidays.length > 0 && (
				<span className={styles.holidayIcons}>
					{dayHolidays.map(holiday => {
						// The name is rendered next to the icon rather than hidden behind a tooltip, which
						// would be unreachable on a touch screen
						const content = (
							<>
								<span className={styles.holidayIcon} role="img" aria-label={holiday.name}>
									{holiday.icon}
								</span>
								<span className={styles.holidayName}>{holiday.name}</span>
							</>
						);

						return holiday.url ? (
							<a
								key={holiday.id}
								href={holiday.url}
								target="_blank"
								rel="noopener noreferrer"
								className={styles.holidayIconLink}
							>
								{content}
							</a>
						) : (
							<span key={holiday.id} className={styles.holidayEntry}>
								{content}
							</span>
						);
					})}
				</span>
			)}
			{date}
		</span>
	);
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

function pluralize(count: number, singular = "", plural = `${singular}s`) {
	return count === 1 ? singular : plural;
}

interface ReservationPillProps {
	teamNumber: string | number;
	onRemove?: () => void;
	isTemp?: boolean;
	isPendingDeletion?: boolean;
	isPendingAddition?: boolean;
	hasEnded?: boolean;
	disabled?: boolean;
}

function ReservationPill({
	teamNumber,
	onRemove,
	isTemp = false,
	isPendingDeletion = false,
	isPendingAddition = false,
	hasEnded = false,
	disabled = false,
}: ReservationPillProps) {
	const teamStr = teamNumber.toString();
	const number = Number.parseInt(teamStr);
	const [isActive, setIsActive] = useState(false);
	const pillRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(event: MouseEvent | TouchEvent) {
			if (pillRef.current && !pillRef.current.contains(event.target as Node)) {
				setIsActive(false);
			}
		}

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("touchstart", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("touchstart", handleClickOutside);
		};
	}, []);

	// Use 1.5em for more prominent avatar, wrapped to not affect text height
	const avatar = number ? (
		<span style={{ lineHeight: 0 }}>
			<TeamAvatar teamNumber={number} size="1.5em" />
		</span>
	) : null;

	const pillClasses = [styles.reservationPill];
	if (isPendingDeletion) pillClasses.push(styles.pendingDeletion);
	if (isPendingAddition) pillClasses.push(styles.pendingAddition);
	if (isActive) pillClasses.push(styles.active);

	const displayText = teamStr || (isTemp ? "New Reservation" : teamStr);

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: The pill is just a container, the X button is the interactive element
		// biome-ignore lint/a11y/noStaticElementInteractions: The pill is just a container, the X button is the interactive element
		<div
			ref={pillRef}
			className={pillClasses.join(" ")}
			onClick={() => setIsActive(true)}
			onTouchStart={() => setIsActive(true)}
		>
			{avatar}
			<span className={styles.reservationPillText} style={isTemp ? { userSelect: "none" } : {}}>
				{displayText}
			</span>
			{onRemove && !hasEnded && (
				<button
					style={{ userSelect: "none" }}
					type="button"
					onClick={onRemove}
					className={styles.removeReservationBtn}
					disabled={disabled}
				>
					{disabled ? "⌛" : "×"}
				</button>
			)}
		</div>
	);
}

export function ReservationCalendar({
	initialReservations,
	initialHolidays,
	initialBlackouts,
	initialWeather,
	isAdmin = false,
}: {
	initialReservations: InitialReservations;
	initialHolidays: Holiday[];
	initialBlackouts: Blackout[];
	/** Null when weather is disabled or no forecast is available */
	initialWeather: WeatherForecast | null;
	/** Admins may book over a blackout, so they still get the add button on a closed slot */
	isAdmin?: boolean;
}) {
	const [historyDays, setHistoryDays] = useState(0);
	const [additionalReservations, setAdditionalReservations] = useState<InitialReservations>([]);
	const { setIsLoadingHistory, setLoadHistory } = useHistory();
	const { timeSlotBorders, reservationDays, timeZone } = useAppConfig();

	const startDate = useInterval(
		() => {
			const today = getToday(timeZone);

			const lastTimeSlot = timeSlotBorders[timeSlotBorders.length - 1];
			if (lastTimeSlot === undefined) throw new Error("TimeSlotBorders is empty");

			const lastEventToday = createDateFromDateStringHour(today, lastTimeSlot + 12, timeZone);

			// Start tomorrow after the last time slot of the day
			if (new Date() >= lastEventToday) return addDaysToDateString(today, 1);

			return today;
		},
		1000,
		[timeSlotBorders, timeZone],
	);

	const daysText = `${reservationDays} ${pluralize(reservationDays, "day")}`;

	// Combine initial reservations with additional history
	const allReservations = useMemo(() => {
		const combined = [...additionalReservations, ...initialReservations];
		// Sort by date to ensure chronological order (earliest first)
		return combined.sort((a, b) => a.date.localeCompare(b.date));
	}, [additionalReservations, initialReservations]);

	const utils = api.useUtils();

	// Blackouts change rarely and apply to every day on screen, so they're fetched once here and
	// passed down rather than queried per slot
	const { data: blackouts = initialBlackouts } = api.blackout.list.useQuery(undefined, {
		initialData: initialBlackouts,
	});

	// The server refreshes its cached forecast on its own schedule; this just picks up the latest
	const { data: weather = initialWeather } = api.weather.forecast.useQuery(undefined, {
		initialData: initialWeather,
		refetchInterval: 15 * 60 * 1000,
	});

	// Use refs to store current values to avoid dependency issues
	const startDateRef = useRef(startDate);
	const historyDaysRef = useRef(historyDays);
	const utilsRef = useRef(utils);

	// Update refs when values change
	useEffect(() => {
		startDateRef.current = startDate;
	}, [startDate]);

	useEffect(() => {
		historyDaysRef.current = historyDays;
	}, [historyDays]);

	useEffect(() => {
		utilsRef.current = utils;
	}, [utils]);

	const loadHistory = useCallback(async () => {
		setIsLoadingHistory(true);

		try {
			// Load 7 days of history, one at a time
			const totalDaysToLoad = 7;
			const currentHistoryDays = historyDaysRef.current;

			for (let i = 0; i < totalDaysToLoad; i++) {
				const newDate = addDaysToDateString(startDateRef.current, -currentHistoryDays - i - 1);

				// Fetch data for this single day
				const newReservation = {
					date: newDate,
					reservations: await utilsRef.current.reservation.list.fetch({ date: newDate }),
				};

				// Add this day and increment count - this will trigger the transition
				setAdditionalReservations(prev => [newReservation, ...prev]);
				setHistoryDays(prev => prev + 1);

				// Small delay between each day
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		} catch (error) {
			console.error("Failed to load history:", error);
		} finally {
			setIsLoadingHistory(false);
		}
	}, [setIsLoadingHistory]);

	// Register the load history function with the context only once
	useEffect(() => {
		setLoadHistory(() => loadHistory);
	}, [setLoadHistory]);

	return (
		<>
			<div className={styles.calendarGrid}>
				<Days
					start={startDate}
					days={reservationDays + 1}
					daysHistory={historyDays}
					initialReservations={allReservations}
					initialHolidays={initialHolidays}
					blackouts={blackouts}
					weather={weather}
					isAdmin={isAdmin}
				/>
			</div>
			<p>
				We only allow reservations for the next {daysText}.
				<br />
				Please check back later for more availability.
			</p>
			{weather && (
				// Open-Meteo's data is CC BY 4.0, which requires this credit
				<p className={styles.weatherAttribution}>
					Weather for {weather.location}, from{" "}
					<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
						Open-Meteo.com
					</a>
				</p>
			)}
		</>
	);
}

function getProgressPercentage(startTime: Date, endTime: Date, now: Date): number {
	return Math.min(
		100,
		Math.max(0, ((now.getTime() - startTime.getTime()) / (endTime.getTime() - startTime.getTime())) * 100),
	);
}

function TimeSlotHeader({ startHour, endHour }: { startHour: number; endHour: number }) {
	const { timeZone } = useAppConfig();
	const now = useInterval(() => new Date(), 1000);
	const today = getToday(timeZone);
	const startTime = createDateFromDateStringHour(today, startHour, timeZone);
	const endTime = createDateFromDateStringHour(today, endHour, timeZone);
	const hasStarted = now >= startTime;
	const hasEnded = now >= endTime;
	const current = hasStarted && !hasEnded;

	// Calculate progress percentage for current time slot
	const progress = current ? getProgressPercentage(startTime, endTime, now) : 0;

	return (
		<div className={styles.timeSlotHeader} suppressHydrationWarning>
			<div className={styles.timeSlotHeaderContent}>
				<TimeRangeDisplay date={today} start={startHour} end={endHour} />
			</div>
			{current && (
				<div className={styles.timeSlotHeaderProgress} style={{ left: `${progress}%` }} suppressHydrationWarning />
			)}
		</div>
	);
}

function Days({
	start,
	days,
	daysHistory,
	initialReservations,
	initialHolidays,
	blackouts,
	weather,
	isAdmin,
}: {
	start: string;
	days: number;
	daysHistory?: number;
	initialReservations: InitialReservations;
	initialHolidays: Holiday[];
	blackouts: Blackout[];
	weather: WeatherForecast | null;
	isAdmin: boolean;
}) {
	// Ensure good type
	daysHistory ??= 0;

	const { timeSlotBorders } = useAppConfig();
	const dates = Array.from({ length: days }, (_, i) => addDaysToDateString(start, i));
	const datesHistory = Array.from({ length: daysHistory }, (_, i) => addDaysToDateString(start, i - daysHistory));

	return (
		<>
			{/* History columns */}
			{datesHistory.map(date => (
				<DayWrapper
					key={date}
					date={date}
					initialReservations={initialReservations}
					initialHolidays={initialHolidays}
					blackouts={blackouts}
					weather={weather}
					isAdmin={isAdmin}
					isHistory={true}
				/>
			))}

			{/* Time slot headers */}
			<div
				className={styles.timeSlotHeaders}
				style={
					{
						"--columns": timeSlotBorders.length - 1,
					} as React.CSSProperties & { "--columns": number }
				}
			>
				{timeSlotBorders.map((_, index, a) => {
					if (index === a.length - 1) return null;

					const startHours = a[index];
					const endHours = a[index + 1];
					if (startHours === undefined || endHours === undefined) throw new Error("TimeSlotBorders is empty");

					const startHour = 12 + startHours;
					const endHour = 12 + endHours;

					return <TimeSlotHeader key={`header_${startHour}`} startHour={startHour} endHour={endHour} />;
				})}
			</div>
			{/* Day columns */}
			{dates.map(date => (
				<DayWrapper
					key={date}
					date={date}
					initialReservations={initialReservations}
					initialHolidays={initialHolidays}
					blackouts={blackouts}
					weather={weather}
					isAdmin={isAdmin}
				/>
			))}
		</>
	);
}

function DayWrapper({
	date,
	initialReservations,
	initialHolidays,
	blackouts,
	weather,
	isAdmin,
	isHistory = false,
}: {
	date: string;
	initialReservations: InitialReservations;
	initialHolidays: Holiday[];
	blackouts: Blackout[];
	weather: WeatherForecast | null;
	isAdmin: boolean;
	isHistory?: boolean;
}) {
	return (
		<div className={`${styles.calendarDay} ${isHistory ? styles.historyDay : ""}`}>
			<Day
				date={date}
				initialReservations={initialReservations}
				initialHolidays={initialHolidays}
				blackouts={blackouts}
				weather={weather}
				isAdmin={isAdmin}
			/>
		</div>
	);
}

function Day({
	date,
	initialReservations,
	initialHolidays,
	blackouts,
	weather,
	isAdmin,
}: {
	date: string;
	initialReservations: InitialReservations;
	initialHolidays: Holiday[];
	blackouts: Blackout[];
	weather: WeatherForecast | null;
	isAdmin: boolean;
}) {
	const { timeSlotBorders } = useAppConfig();
	const closedAllDay = isWholeDayBlackedOut(blackouts, date);

	const style = [styles.dayContainer];
	if (isWeekend(date)) style.push(styles.weekend);
	if (closedAllDay) style.push(styles.dayClosed);

	// Calculate number of time slots (subtract 1 because we map pairs)
	const numSlots = timeSlotBorders.length - 1;

	return (
		<div className={style.join(" ")}>
			<div className={styles.dayHeader}>
				<DayName date={date} />
				<DayDate date={date} holidays={initialHolidays} />
				{closedAllDay && <span className={styles.dayClosedChip}>Field closed</span>}
			</div>
			<div
				className={styles.timeSlotRow}
				style={
					{
						"--columns": numSlots,
						gridTemplateColumns: `repeat(${numSlots}, 1fr)`,
					} as React.CSSProperties & { "--columns": number }
				}
			>
				{timeSlotBorders.map((_, index, a) => {
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
							initialHolidays={initialHolidays}
							blackouts={blackouts}
							isAdmin={isAdmin}
						/>
					);
				})}
				{/* A second row in the same grid, so each slot's forecast sits directly beneath it */}
				<DayWeather date={date} forecast={weather} />
			</div>
		</div>
	);
}

function TimeSlot({
	date,
	startHour,
	endHour,
	initialReservations,
	initialHolidays,
	blackouts,
	isAdmin,
}: {
	date: string;
	startHour: number;
	endHour: number;
	initialReservations: InitialReservations;
	initialHolidays: Holiday[];
	blackouts: Blackout[];
	isAdmin: boolean;
}) {
	const [isAdding, setIsAdding] = useState(false);
	const [teamNumber, setTeamNumber] = useState(() => {
		// Load last used team number from localStorage
		if (typeof window !== "undefined") {
			return localStorage.getItem("lastTeamNumber") || "";
		}
		return "";
	});
	const [priority, setPriority] = useState(false);
	const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set());
	const [tempTeamNumber, setTempTeamNumber] = useState<string | null>(null);
	// Why the last add or remove failed. Without this the server's refusal was
	// invisible: the dialog just sat there, because it only closes on success.
	const [error, setError] = useState<string | null>(null);
	const utils = api.useUtils();
	const { timeZone } = useAppConfig();

	const handleCancelAdd = useCallback(() => {
		setIsAdding(false);
		setTeamNumber("");
		setPriority(false);
		setTempTeamNumber(null);
		setError(null);
	}, []);

	useEffect(() => {
		function handleEsc(event: KeyboardEvent) {
			if (event.key === "Escape" && isAdding) {
				handleCancelAdd();
			}
		}

		document.addEventListener("keydown", handleEsc);
		return () => {
			document.removeEventListener("keydown", handleEsc);
		};
	}, [isAdding, handleCancelAdd]);

	const slot = hourToTimeSlot(startHour);

	// Calculate days difference
	const today = useInterval(() => getToday(timeZone), 1000, [timeZone]);
	const _diffDays = getDateDaysDifference(date, today);

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
			setError(null);

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
						priority: newReservation.priority,
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
			// The dialog stays open, so say why rather than looking like nothing happened
			setError(err.message);
		},
		onSettled: () => {
			// Don't refetch
		},
	});

	const removeReservation = api.reservation.remove.useMutation({
		onMutate: async ({ id }) => {
			setError(null);

			// Cancel any outgoing refetches
			await utils.reservation.list.cancel();

			// Get the current data for the affected date
			const previousData = utils.reservation.list.getData({ date });

			// Mark the reservation as pending deletion in local state
			setPendingDeletions(prev => new Set([...prev, id]));

			return { previousData };
		},
		onSuccess: (_data, { id }) => {
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
			// The pill reappearing on its own looks like a glitch; say what happened
			setError(err.message);
		},
	});

	// Create Date objects for time comparisons using lab timezone
	const startTime = createDateFromDateStringHour(date, startHour, timeZone);
	const endTime = createDateFromDateStringHour(date, endHour, timeZone);

	const now = useInterval(() => new Date(), 1000);
	const hasStarted = now >= startTime;
	const hasEnded = now >= endTime;
	const current = hasStarted && !hasEnded;

	// Calculate progress percentage for current time slot
	const progress = current ? getProgressPercentage(startTime, endTime, now) : 0;

	// Blacked-out slots can't be booked. Any reservation made before the blackout was created is
	// still shown so the team can see it (and cancel it).
	const blackout = findBlackoutForSlot(blackouts, date, slot);

	const style = [styles.timeSlotStackContainer];
	if (current) style.push(styles.timeSlotCurrent);
	if (hasEnded) style.push(styles.timeSlotOver);
	if (blackout) style.push(styles.timeSlotBlackedOut);

	const handleAddReservation = useCallback(() => {
		if (!teamNumber) return;
		// Don't clear tempTeamNumber here - let the optimistic update handle it
		addReservation.mutate({
			date: date,
			slot: slot,
			team: teamNumber,
			notes: "",
			priority,
		});
	}, [
		date,
		slot,
		teamNumber,
		priority, // Don't clear tempTeamNumber here - let the optimistic update handle it
		addReservation.mutate,
	]);

	const handleOpenAddModal = useCallback(() => {
		setIsAdding(true);
		setTempTeamNumber(""); // Start with empty temporary pill
		setPriority(false); // Reset priority when opening modal
	}, []);

	return (
		<div className={style.join(" ")} suppressHydrationWarning>
			{current && <div className={styles.timeSlotProgress} style={{ left: `${progress}%` }} suppressHydrationWarning />}
			{blackout && (
				<div className={styles.blackoutNotice}>
					<span className={styles.blackoutLabel}>Closed</span>
					{blackout.reason && <span className={styles.blackoutReason}>{blackout.reason}</span>}
					{isAdmin && <span className={styles.blackoutAdminHint}>Admins can still book</span>}
				</div>
			)}
			<div className={styles.reservationStack}>
				{/* Existing reservations */}
				{slotReservations.map(r => (
					<ReservationPill
						key={r.id}
						teamNumber={r.team}
						isPendingDeletion={pendingDeletions.has(r.id)}
						isPendingAddition={r.id === "temp-id"}
						hasEnded={hasEnded}
						disabled={pendingDeletions.has(r.id)}
						onRemove={() => {
							console.log("Removing reservation:", {
								id: r.id,
							});
							removeReservation.mutate({
								id: r.id,
							});
						}}
					/>
				))}
				{/* Pending addition */}
				{tempTeamNumber !== null && isAdding && (
					<ReservationPill teamNumber={tempTeamNumber} isTemp={true} isPendingAddition={true} />
				)}
			</div>
			{/* A failed removal has no dialog to report into. Tap to dismiss. */}
			{error && !isAdding && (
				<button type="button" className={styles.slotError} onClick={() => setError(null)}>
					{error}
				</button>
			)}
			{/* Add reservation button. Admins are exempt from blackouts, so they keep it. */}
			{!hasEnded && (!blackout || isAdmin) && (
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
							<DayDate date={date} holidays={initialHolidays} />
							<TimeRangeDisplay date={date} start={startHour} end={endHour} />
						</div>
						{error && (
							<div className={styles.modalError} role="alert">
								{error}
							</div>
						)}
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
										const value = e.target.value;
										setTeamNumber(value);
										setTempTeamNumber(value);
										// Save to localStorage for next time
										if (typeof window !== "undefined") {
											localStorage.setItem("lastTeamNumber", value);
										}
									}}
									placeholder="Enter team number"
								/>
							</div>
							<div className={styles.modalActions}>
								<button type="submit" disabled={!teamNumber || addReservation.isPending}>
									{addReservation.isPending ? "Adding..." : "Add"}
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
