"use client";

import { useEffect, useMemo, useState } from "react";
import { formatHour, getSlotWindows, getTimeSlots, type SlotWindow } from "~/server/util/timeSlots";
import {
	buildSlotSparklines,
	describeWeather,
	type SlotWeather,
	summarizeDayWeather,
	valueAtEdge,
	type WeatherCondition,
} from "~/server/util/weather";
import type { EventDate, WeatherForecast } from "~/types";
import styles from "../index.module.css";
import { formatTemperature, Temperature } from "./Temperature";

// Coordinate space of each slot's sparkline. The rendered size comes from CSS; the drawing
// stretches to fill its cell.
const SparklineWidth = 100;
const SparklineHeight = 24;

/**
 * How far each slot's lines carry on past its right edge, in sparkline units, to cross the gap to
 * the next slot. Anything wider than the gap works; CSS clips it to the gap itself.
 */
const Continuation = SparklineWidth;

/** Chances of rain below this are shown, but played down */
const RainWorthMentioning = 10;

/**
 * The forecast for one day's reservable hours, as one cell beneath each time slot: a sparkline of
 * temperature and chance of rain, captioned with the temperature at each slot border and, for each
 * slot, its chance of rain flanked by the conditions over its first and second half.
 *
 * Renders the cells alone (no wrapper) so they join the slots' own grid as a second row. That keeps
 * every cell exactly as wide as the slot above it, at any screen width. Within a cell, time runs
 * linearly from the slot's start to its end, just like the slot's progress line.
 */
export function DayWeather({ date, forecast }: { date: EventDate; forecast: WeatherForecast | null }) {
	const slots = useMemo(() => getTimeSlots(), []);
	const windows = useMemo(() => getSlotWindows(date), [date]);
	const day = useMemo(
		() => (forecast ? summarizeDayWeather(forecast.samples, windows) : undefined),
		[forecast, windows],
	);
	const sparklines = useMemo(
		() =>
			day && buildSlotSparklines(day, { width: SparklineWidth, height: SparklineHeight, continuation: Continuation }),
		[day],
	);

	const now = useClientNow(30 * 1000);

	if (!day || !sparklines) return null;

	const lastIndex = sparklines.length - 1;

	return (
		<>
			{sparklines.map((sparkline, index) => {
				const slot = slots[index];
				const weather = day.slots[index];
				const window = windows[index];
				if (!slot || !weather || !window) return null;

				const from = formatHour(slot.startHour);
				const until = formatHour(slot.endHour);
				const startTemperature = valueAtEdge(weather.temperature, 0);
				const endTemperature = valueAtEdge(weather.temperature, 1);

				const cell = [styles.weatherCell];
				if (index === 0) cell.push(styles.weatherCellFirst);
				if (index === lastIndex) cell.push(styles.weatherCellLast);
				// Matches the slot above, which fades once it's over
				if (now !== undefined && now >= window.end) cell.push(styles.weatherCellOver);

				return (
					<div key={slot.slot} className={cell.join(" ")} role="img" aria-label={describeSlot(weather, from, until)}>
						<div className={styles.weatherChart}>
							<svg
								className={styles.weatherSparkline}
								viewBox={`0 0 ${SparklineWidth} ${SparklineHeight}`}
								preserveAspectRatio="none"
								aria-hidden="true"
								focusable="false"
							>
								{sparkline.precipitationArea && (
									<path className={styles.weatherRainArea} d={sparkline.precipitationArea} />
								)}
								{sparkline.precipitation && (
									<path
										className={styles.weatherRainLine}
										d={sparkline.precipitation}
										vectorEffect="non-scaling-stroke"
									/>
								)}
								{sparkline.temperature && (
									<path
										className={styles.weatherTemperatureLine}
										d={sparkline.temperature}
										vectorEffect="non-scaling-stroke"
									/>
								)}
							</svg>
							<NowMarker {...window} />
						</div>
						{/* Hidden from screen readers, which get the cell's label instead */}
						<div className={styles.weatherCaptions} aria-hidden="true">
							{/* Each slot shows the temperature at its start. Borders are shared, so only the last
							    slot shows its end as well. */}
							{startTemperature !== undefined && (
								<span className={`${styles.weatherCaption} ${styles.weatherCaptionStart} ${styles.weatherTemperature}`}>
									<Temperature celsius={startTemperature} style="short" />
								</span>
							)}
							<ConditionIcon condition={weather.conditions[0]} className={styles.weatherCaptionFirstHalf} />
							{weather.chanceOfRain !== undefined && (
								<span
									className={[
										styles.weatherCaption,
										styles.weatherCaptionMiddle,
										styles.weatherRain,
										weather.chanceOfRain < RainWorthMentioning ? styles.weatherRainUnlikely : "",
									].join(" ")}
								>
									{Math.round(weather.chanceOfRain)}%
								</span>
							)}
							<ConditionIcon condition={weather.conditions[1]} className={styles.weatherCaptionSecondHalf} />
							{index === lastIndex && endTemperature !== undefined && (
								<span className={`${styles.weatherCaption} ${styles.weatherCaptionEnd} ${styles.weatherTemperature}`}>
									<Temperature celsius={endTemperature} style="short" />
								</span>
							)}
						</div>
					</div>
				);
			})}
		</>
	);
}

/**
 * How far through the slot it is now, drawn with the same element, style, and once-a-second update
 * as the slot's own progress line above, so the two form one unbroken line.
 */
function NowMarker({ start, end }: SlotWindow) {
	const now = useClientNow(1000);
	if (now === undefined || now < start || now >= end) return null;

	return <div className={styles.timeSlotProgress} style={{ left: `${((now - start) / (end - start)) * 100}%` }} />;
}

function ConditionIcon({ condition, className }: { condition: WeatherCondition | undefined; className?: string }) {
	if (!condition) return null;
	return (
		<span className={`${styles.weatherCaption} ${styles.weatherIcon} ${className}`}>
			{describeWeather(condition).icon}
		</span>
	);
}

/** Everything a cell shows, in words */
function describeSlot(weather: SlotWeather, from: string, until: string): string {
	const parts: string[] = [];

	const start = valueAtEdge(weather.temperature, 0);
	const end = valueAtEdge(weather.temperature, 1);
	if (start !== undefined) parts.push(`${formatTemperature(start)} at ${from}`);
	if (end !== undefined) parts.push(`${formatTemperature(end)} at ${until}`);

	const [first, second] = weather.conditions.map(condition =>
		condition ? describeWeather(condition).description.toLowerCase() : undefined,
	);
	if (first && second) parts.push(first === second ? first : `${first}, then ${second}`);
	else if (first || second) parts.push(first || second || "");

	if (weather.chanceOfRain !== undefined) parts.push(`${Math.round(weather.chanceOfRain)}% chance of rain`);

	const hours = `${from} to ${until}`;
	return parts.length ? `Forecast for ${hours}: ${parts.join(", ")}` : `No forecast for ${hours}`;
}

/**
 * The current time, refreshed every `interval` ms, or undefined until mounted.
 *
 * The server's clock would disagree with the browser's, so nothing time-dependent is rendered until
 * hydration is done.
 */
function useClientNow(interval: number): number | undefined {
	const [now, setNow] = useState<number>();

	useEffect(() => {
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), interval);
		return () => clearInterval(timer);
	}, [interval]);

	return now;
}
