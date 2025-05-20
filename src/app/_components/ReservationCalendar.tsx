"use client";

import styles from "../index.module.css";
import { useInterval } from "./useInterval";

const TimeSlotBorders = [-2, 1, 4, 7, 10]; // Relative to noon
const ReservationDays = 7;
const TimeZone = "America/Los_Angeles";

function pluralize(count: number, singular = "", plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function ReservationCalendar() {
  const start = useInterval(() => {
    const now = new Date();

    // Add 12 because time slots are relative to noon
    if (now.getHours() >= 12 + TimeSlotBorders[TimeSlotBorders.length - 1]!) {
      // Start tomorrow after the last time slot of the day
      now.setDate(now.getDate() + 1);
    }

    // Set time to local midnight
    now.setHours(0, 0, 0, 0);

    return now.getTime();
  });

  const daysText = ReservationDays + " " + pluralize(ReservationDays, "day");

  return (
    TimeZoneAlert() ?? (
      <>
        <div className={styles.calendarGrid}>
          <Days start={new Date(start)} days={ReservationDays + 1} />
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
  return useInterval(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    500
  );
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

function Days({ start, days }: { start: Date; days: number }) {
  const dates = Array.from({ length: days }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });

  return (
    <>
      {dates.map((date) => (
        <div key={date.getTime()} className={styles.calendarDay}>
          <Day date={date} />
        </div>
      ))}
    </>
  );
}

function Day({ date }: { date: Date }) {
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
    <div
      className={
        isWeekend
          ? `${styles.dayContainer} ${styles.weekend}`
          : styles.dayContainer
      }
    >
      <div className={styles.dayHeader}>
        <span className={styles.dayName}>
          {dayString}{" "}
          {dayLabel && <span className={styles.dayLabel}>{dayLabel}</span>}
        </span>
        <span className={styles.dayDate}>{dateString}</span>
      </div>
      <div className={styles.timeSlotRow}>
        {TimeSlotBorders.map((_, index, a) => {
          if (index === a.length - 1) return null;
          const start = new Date(date);
          const end = new Date(date);

          start.setHours(12 + a[index]!, 0, 0, 0);
          end.setHours(12 + a[index + 1]!, 0, 0, 0);

          return <TimeSlot key={index} start={start} end={end} index={index} />;
        })}
      </div>
    </div>
  );
}

function dateToTime(date: Date) {
  return date
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    .replace(" AM", "am")
    .replace(" PM", "pm")
    .replace(" ", "\u00A0");
}

function TimeSlot({ start, end }: { start: Date; end: Date; index: number }) {
  // Example reservations for demonstration
  //   const reservations = [predictableGenerator(), predictableGenerator()];
  const reservations = ["1", "2"];


  const hasStarted = useInterval(() => new Date() >= start, 1000, [start]);
  const hasEnded = useInterval(() => new Date() >= end, 1000, [end]);

  const current = hasStarted && !hasEnded;

  let style = styles.timeSlotStackContainer;
  if (current) style += " " + styles.timeSlotCurrent;
  if (hasEnded) style += " " + styles.timeSlotOver;

  return (
    <div className={style}>
      <div className={styles.timeSlotTime}>
        {dateToTime(start)} - {dateToTime(end)}
      </div>
      <div className={styles.reservationStack}>
        {reservations.map((r, i) => (
          <div key={i} className={styles.reservationPill}>
            {r}
          </div>
        ))}
      </div>
      <button className={styles.addReservationBtn}>+</button>
    </div>
  );
}
