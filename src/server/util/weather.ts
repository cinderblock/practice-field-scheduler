/**
 * Pure helpers for the weather forecast.
 *
 * Nothing here touches the network or the environment, so it is safe to use from both the server
 * and client components. Times are epoch milliseconds; temperatures are Celsius.
 */

import type { WeatherSample } from "~/types";
import type { SlotWindow } from "./timeSlots";

export type Coordinates = { latitude: number; longitude: number };

export type WeatherLocationSetting = ({ kind: "coordinates" } & Coordinates) | { kind: "search"; name: string };

export class InvalidWeatherLocationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidWeatherLocationError";
	}
}

const CoordinatesPattern = /^\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*$/;

/**
 * Interpret the WEATHER_LOCATION setting.
 *
 * "37.4,-122.1" is taken as exact coordinates. Anything else is a place name or postal code to look
 * up, e.g. "San Jose, CA" or "95112".
 */
export function parseWeatherLocation(value: string): WeatherLocationSetting {
	const match = CoordinatesPattern.exec(value);
	if (!match) return { kind: "search", name: value.trim() };

	const latitude = Number(match[1]);
	const longitude = Number(match[2]);

	if (Math.abs(latitude) > 90) throw new InvalidWeatherLocationError(`Latitude must be within ±90, got ${latitude}`);
	if (Math.abs(longitude) > 180)
		throw new InvalidWeatherLocationError(`Longitude must be within ±180, got ${longitude}`);

	return { kind: "coordinates", latitude, longitude };
}

/** Coordinates for people to read, e.g. "37.3394° N, 121.8950° W" */
export function formatCoordinates({ latitude, longitude }: Coordinates): string {
	const axis = (value: number, positive: string, negative: string) =>
		`${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;
	return `${axis(latitude, "N", "S")}, ${axis(longitude, "E", "W")}`;
}

export function celsiusToFahrenheit(celsius: number): number {
	return (celsius * 9) / 5 + 32;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local time of day at `time` in `timeZone`, as fractional hours in [0, 24) */
export function hourOfDay(time: number, timeZone: string): number {
	let formatter = hourFormatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hour: "numeric",
			minute: "numeric",
			hourCycle: "h23",
		});
		hourFormatters.set(timeZone, formatter);
	}

	let hour = 0;
	let minute = 0;
	for (const part of formatter.formatToParts(time)) {
		if (part.type === "hour") hour = Number(part.value);
		else if (part.type === "minute") minute = Number(part.value);
	}

	return hour + minute / 60;
}

/**
 * Keep only the samples within `marginHours` of the reservable part of the day.
 *
 * The margin keeps the neighbours needed to interpolate a value exactly at the first and last slot
 * borders. `startHour` and `endHour` are absolute hours (0-24); the window may wrap past midnight.
 */
export function filterSamplesToHours(
	samples: readonly WeatherSample[],
	{
		timeZone,
		startHour,
		endHour,
		marginHours = 1,
	}: { timeZone: string; startHour: number; endHour: number; marginHours?: number },
): WeatherSample[] {
	const from = startHour - marginHours;
	const until = endHour + marginHours;

	return samples.filter(sample => {
		const hour = hourOfDay(sample.time, timeZone);
		// Check the same local time as seen from the previous and next day too, for windows that
		// cross midnight
		return [hour - 24, hour, hour + 24].some(h => h >= from && h <= until);
	});
}

const Hour = 60 * 60 * 1000;

/** Samples further apart than this are treated as a gap rather than interpolated across */
const MaxInterpolationGap = 3 * Hour;

type Series = { time: number; value: number }[];

function toSeries(
	samples: readonly WeatherSample[],
	pick: (sample: WeatherSample) => number | null,
	/** Where to plot each value, relative to its sample's time */
	offset = 0,
): Series {
	const series: Series = [];
	for (const sample of samples) {
		const value = pick(sample);
		if (value !== null && Number.isFinite(value)) series.push({ time: sample.time + offset, value });
	}
	return series;
}

/** The series' value at `time`, linearly interpolated. Undefined if there's no data around then. */
export function valueAt(series: Series, time: number): number | undefined {
	// Series are short (a few hundred points at most), so a linear scan is fine
	const after = series.findIndex(point => point.time >= time);
	if (after < 0) return undefined;

	const next = series[after];
	if (!next) return undefined;
	if (next.time === time) return next.value;

	const previous = series[after - 1];
	if (!previous) return undefined;
	if (next.time - previous.time > MaxInterpolationGap) return undefined;

	const fraction = (time - previous.time) / (next.time - previous.time);
	return previous.value + (next.value - previous.value) * fraction;
}

export type WeatherCondition = {
	/** WMO weather interpretation code */
	code: number;
	isDay: boolean;
};

type WmoCode = { description: string; icon: string; nightIcon?: string };

// https://open-meteo.com/en/docs#weather_variable_documentation
const WmoCodes: Record<number, WmoCode> = {
	0: { description: "Clear", icon: "☀️", nightIcon: "🌙" },
	1: { description: "Mostly clear", icon: "🌤️", nightIcon: "🌙" },
	2: { description: "Partly cloudy", icon: "⛅", nightIcon: "☁️" },
	3: { description: "Overcast", icon: "☁️" },
	45: { description: "Fog", icon: "🌫️" },
	48: { description: "Freezing fog", icon: "🌫️" },
	51: { description: "Light drizzle", icon: "🌦️", nightIcon: "🌧️" },
	53: { description: "Drizzle", icon: "🌦️", nightIcon: "🌧️" },
	55: { description: "Heavy drizzle", icon: "🌧️" },
	56: { description: "Light freezing drizzle", icon: "🌧️" },
	57: { description: "Freezing drizzle", icon: "🌧️" },
	61: { description: "Light rain", icon: "🌦️", nightIcon: "🌧️" },
	63: { description: "Rain", icon: "🌧️" },
	65: { description: "Heavy rain", icon: "🌧️" },
	66: { description: "Light freezing rain", icon: "🌧️" },
	67: { description: "Freezing rain", icon: "🌧️" },
	71: { description: "Light snow", icon: "🌨️" },
	73: { description: "Snow", icon: "🌨️" },
	75: { description: "Heavy snow", icon: "❄️" },
	77: { description: "Snow grains", icon: "🌨️" },
	80: { description: "Light showers", icon: "🌦️", nightIcon: "🌧️" },
	81: { description: "Showers", icon: "🌧️" },
	82: { description: "Heavy showers", icon: "🌧️" },
	85: { description: "Snow showers", icon: "🌨️" },
	86: { description: "Heavy snow showers", icon: "❄️" },
	95: { description: "Thunderstorms", icon: "⛈️" },
	96: { description: "Thunderstorms with hail", icon: "⛈️" },
	99: { description: "Thunderstorms with heavy hail", icon: "⛈️" },
};

/** An icon and a plain-language description for a weather condition */
export function describeWeather({ code, isDay }: WeatherCondition): { icon: string; description: string } {
	const known = WmoCodes[code];
	if (!known) return { icon: "❔", description: "Unknown conditions" };
	return { icon: (!isDay && known.nightIcon) || known.icon, description: known.description };
}

/**
 * One code to stand for several hours.
 *
 * Any significant weather (fog, precipitation, storms) wins, and among those the highest code. That
 * is WMO's own convention: its code table is ordered so the highest applicable code is the one to
 * report. Otherwise the codes only describe cloud cover, so the typical cover is used, rather than
 * letting a single overcast hour speak for a sunny afternoon.
 */
export function representativeWeatherCode(codes: readonly number[]): number | undefined {
	if (!codes.length) return undefined;

	const significant = codes.filter(code => code >= 45);
	if (significant.length) return Math.max(...significant);

	return Math.round(codes.reduce((sum, code) => sum + code, 0) / codes.length);
}

function nearestSample<T extends WeatherSample>(samples: readonly T[], time: number, within: number): T | undefined {
	let nearest: T | undefined;
	for (const sample of samples) {
		const distance = Math.abs(sample.time - time);
		if (distance <= within && (!nearest || distance < Math.abs(nearest.time - time))) nearest = sample;
	}
	return nearest;
}

/** Conditions over a stretch of time, from the (instantaneous) hourly codes within it */
function conditionDuring(samples: readonly WeatherSample[], { start, end }: SlotWindow): WeatherCondition | undefined {
	const middle = (start + end) / 2;

	const coded = samples.flatMap(sample =>
		sample.weatherCode === null ? [] : [{ ...sample, weatherCode: sample.weatherCode }],
	);
	let during = coded.filter(sample => sample.time >= start && sample.time < end);
	// A stretch shorter than an hour may not contain a sample at all
	if (!during.length) {
		const nearest = nearestSample(coded, middle, Hour);
		during = nearest ? [nearest] : [];
	}

	const code = representativeWeatherCode(during.map(sample => sample.weatherCode));
	if (code === undefined) return undefined;

	const light = nearestSample(
		samples.filter(sample => sample.isDay !== null),
		middle,
		Hour,
	);

	return { code, isDay: light?.isDay ?? true };
}

/**
 * The highest chance of rain in any hour that overlaps the window.
 *
 * Each sample gives the chance of rain over the hour *before* it, so the sample at the window's start
 * is about time before the window, and when the window ends mid-hour, the first sample after it
 * still overlaps.
 */
function chanceOfRainDuring(samples: readonly WeatherSample[], { start, end }: SlotWindow): number | undefined {
	const chances = samples.flatMap(sample =>
		sample.time > start && sample.time - Hour < end && sample.precipitationProbability !== null
			? [sample.precipitationProbability]
			: [],
	);

	return chances.length ? Math.max(...chances) : undefined;
}

/** A value somewhere within a slot */
export type SlotPoint = {
	/** How far through the slot, 0 (start) to 1 (end) */
	position: number;
	value: number;
};

export type SlotWeather = {
	temperature: SlotPoint[];
	/** For drawing: each value is placed in the middle of the hour it describes */
	precipitationProbability: SlotPoint[];
	/** The highest chance of rain in any hour overlapping the slot */
	chanceOfRain: number | undefined;
	/** Conditions over the first and the second half of the slot */
	conditions: [WeatherCondition | undefined, WeatherCondition | undefined];
};

export type DayWeather = {
	/** In slot order */
	slots: SlotWeather[];
	temperatureMin: number;
	temperatureMax: number;
	/** Undefined when the forecast has no precipitation data for the day */
	precipitationProbabilityMax: number | undefined;
};

function pointsInWindow(series: Series, { start, end }: SlotWindow): SlotPoint[] {
	const duration = end - start;
	if (duration <= 0) return [];

	const points: SlotPoint[] = [];
	const push = (time: number, value: number | undefined) => {
		if (value !== undefined) points.push({ position: (time - start) / duration, value });
	};

	// Values exactly at the borders let a slot's line run edge to edge, and meet its neighbour's,
	// even when borders fall between hourly samples
	push(start, valueAt(series, start));
	for (const point of series) {
		if (point.time > start && point.time < end) push(point.time, point.value);
	}
	push(end, valueAt(series, end));

	return points;
}

/** The lowest and highest value among some points, or undefined if there are none */
export function valueRange(points: readonly SlotPoint[]): { min: number; max: number } | undefined {
	if (!points.length) return undefined;
	const values = points.map(point => point.value);
	return { min: Math.min(...values), max: Math.max(...values) };
}

/** The value exactly at a slot's start (`0`) or end (`1`), if there is one */
export function valueAtEdge(points: readonly SlotPoint[], edge: 0 | 1): number | undefined {
	return points.find(point => point.position === edge)?.value;
}

/**
 * Reduce a forecast to what is shown for one day: the weather during each of its slots.
 *
 * Returns undefined if the forecast doesn't cover any of the day's reservable hours.
 */
export function summarizeDayWeather(
	samples: readonly WeatherSample[],
	windows: readonly SlotWindow[],
): DayWeather | undefined {
	const temperature = toSeries(samples, sample => sample.temperature);
	const precipitationProbability = toSeries(samples, sample => sample.precipitationProbability, -Hour / 2);

	const slots = windows.map((window): SlotWeather => {
		const middle = (window.start + window.end) / 2;
		return {
			temperature: pointsInWindow(temperature, window),
			precipitationProbability: pointsInWindow(precipitationProbability, window),
			chanceOfRain: chanceOfRainDuring(samples, window),
			conditions: [
				conditionDuring(samples, { start: window.start, end: middle }),
				conditionDuring(samples, { start: middle, end: window.end }),
			],
		};
	});

	const temperatures = valueRange(slots.flatMap(slot => slot.temperature));
	if (!temperatures) return undefined;

	return {
		slots,
		temperatureMin: temperatures.min,
		temperatureMax: temperatures.max,
		precipitationProbabilityMax: valueRange(slots.flatMap(slot => slot.precipitationProbability))?.max,
	};
}

/**
 * The smallest temperature range the sparkline stretches to fill, in °C (about 9°F).
 *
 * Without it, a day that only varies by a degree would be drawn as dramatically as one that swings
 * twenty.
 */
export const MinimumTemperatureSpan = 5;

export type SlotSparkline = {
	/** Path data for the temperature line, if there's temperature data during the slot */
	temperature: string | undefined;
	/** Path data for the chance-of-rain line, if there's any chance of rain during the day */
	precipitation: string | undefined;
	/** Path data for the area under the chance-of-rain line */
	precipitationArea: string | undefined;
};

type Vertex = [x: number, y: number];

function round(value: number) {
	return Math.round(value * 100) / 100;
}

function linePath(vertices: readonly Vertex[]): string | undefined {
	return vertices.length ? vertices.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("") : undefined;
}

/**
 * Lay out each slot's weather as SVG paths in its own `width` × `height` box, all drawn to one scale
 * for the day. Temperature fills the day's own range; chance of rain always uses 0-100%.
 *
 * Every slot but the last carries its closing values on for `continuation` past its right edge, so
 * its lines can bridge the gap to the next slot. The gap is a single instant, so the carried value
 * is exact. The caller clips the overhang to the actual gap.
 */
export function buildSlotSparklines(
	day: DayWeather,
	{
		width,
		height,
		padding = 2,
		continuation = 0,
	}: { width: number; height: number; padding?: number; continuation?: number },
): SlotSparkline[] {
	const span = Math.max(day.temperatureMax - day.temperatureMin, MinimumTemperatureSpan);
	const lowest = (day.temperatureMax + day.temperatureMin) / 2 - span / 2;
	const temperatureY = (value: number) => round(height - padding - ((value - lowest) / span) * (height - 2 * padding));
	const rainY = (value: number) => round(height - (Math.min(Math.max(value, 0), 100) / 100) * height);

	const lastSlot = day.slots.length - 1;

	return day.slots.map((slot, index) => {
		// Vertices, plus the carried-on value where the slot's data reaches its end
		const vertices = (points: readonly SlotPoint[], y: (value: number) => number): Vertex[] => {
			const result = points.map((point): Vertex => [round(point.position * width), y(point.value)]);
			const last = points[points.length - 1];
			if (continuation > 0 && index < lastSlot && last?.position === 1) {
				result.push([round(width + continuation), y(last.value)]);
			}
			return result;
		};

		const rain = day.precipitationProbabilityMax ? vertices(slot.precipitationProbability, rainY) : [];
		const first = rain[0];
		const last = rain[rain.length - 1];

		return {
			temperature: linePath(vertices(slot.temperature, temperatureY)),
			precipitation: linePath(rain),
			precipitationArea:
				first && last
					? `M${first[0]} ${height}${rain.map(([x, y]) => `L${x} ${y}`).join("")}L${last[0]} ${height}Z`
					: undefined,
		};
	});
}
