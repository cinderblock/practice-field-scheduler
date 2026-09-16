import { describe, expect, it } from "vitest";
import { formatTemperature } from "~/app/_components/Temperature";
import type { SlotWindow } from "~/server/util/timeSlots";
import {
	buildSlotSparklines,
	celsiusToFahrenheit,
	type DayWeather,
	describeWeather,
	filterSamplesToHours,
	formatCoordinates,
	hourOfDay,
	InvalidWeatherLocationError,
	MinimumTemperatureSpan,
	parseWeatherLocation,
	representativeWeatherCode,
	summarizeDayWeather,
	valueAt,
	valueAtEdge,
	valueRange,
} from "~/server/util/weather";
import type { WeatherSample } from "~/types";

const Hour = 60 * 60 * 1000;

/** Midnight on 2026-09-16 in America/Los_Angeles (PDT, UTC-7) */
const Midnight = Date.UTC(2026, 8, 16, 7);

function at(hour: number) {
	return Midnight + hour * Hour;
}

type ByHour<T> = (hour: number) => T;

/** Hourly samples for the whole day, each value a function of the local hour */
function day({
	temperature = () => 15,
	rain = () => 0,
	code = () => 0,
	isDay = hour => hour >= 7 && hour < 19,
}: {
	temperature?: ByHour<number | null>;
	rain?: ByHour<number | null>;
	code?: ByHour<number | null>;
	isDay?: ByHour<boolean | null>;
} = {}): WeatherSample[] {
	return Array.from({ length: 24 }, (_, hour) => ({
		time: at(hour),
		temperature: temperature(hour),
		precipitationProbability: rain(hour),
		weatherCode: code(hour),
		isDay: isDay(hour),
	}));
}

/** The default slot layout: 10am-4pm, 4pm-7pm, 7pm-10pm */
const Slots: SlotWindow[] = [
	{ start: at(10), end: at(16) },
	{ start: at(16), end: at(19) },
	{ start: at(19), end: at(22) },
];

function summarize(samples: WeatherSample[], windows: SlotWindow[] = Slots): DayWeather {
	const result = summarizeDayWeather(samples, windows);
	if (!result) throw new Error("Expected a summary");
	return result;
}

describe("parseWeatherLocation", () => {
	it("reads latitude,longitude as coordinates", () => {
		expect(parseWeatherLocation("37.3394,-121.895")).toEqual({
			kind: "coordinates",
			latitude: 37.3394,
			longitude: -121.895,
		});
	});

	it("tolerates spaces and explicit signs", () => {
		expect(parseWeatherLocation(" +37.3 , -121 ")).toEqual({ kind: "coordinates", latitude: 37.3, longitude: -121 });
	});

	it("treats anything else as a place to look up", () => {
		expect(parseWeatherLocation("San Jose, CA")).toEqual({ kind: "search", name: "San Jose, CA" });
		expect(parseWeatherLocation(" 95112 ")).toEqual({ kind: "search", name: "95112" });
	});

	it("rejects coordinates that can't exist", () => {
		expect(() => parseWeatherLocation("91,0")).toThrow(InvalidWeatherLocationError);
		expect(() => parseWeatherLocation("0,-180.5")).toThrow(InvalidWeatherLocationError);
	});
});

describe("formatCoordinates", () => {
	it("gives each axis a hemisphere instead of a sign", () => {
		expect(formatCoordinates({ latitude: 37.33939, longitude: -121.89496 })).toBe("37.3394° N, 121.8950° W");
		expect(formatCoordinates({ latitude: -33.8688, longitude: 151.2093 })).toBe("33.8688° S, 151.2093° E");
	});
});

describe("temperature conversion and formatting", () => {
	it("converts Celsius to Fahrenheit", () => {
		expect(celsiusToFahrenheit(0)).toBe(32);
		expect(celsiusToFahrenheit(100)).toBe(212);
		expect(celsiusToFahrenheit(-40)).toBe(-40);
	});

	it("formats whole degrees Fahrenheit, with or without the unit", () => {
		expect(formatTemperature(21)).toBe("70°F");
		expect(formatTemperature(21, "short")).toBe("70°");
		// Just below freezing in Fahrenheit rounds to zero, not "-0"
		expect(formatTemperature(-17.9)).toBe("0°F");
	});
});

describe("describeWeather", () => {
	it("gives an icon and a description for a WMO code", () => {
		expect(describeWeather({ code: 0, isDay: true })).toEqual({ icon: "☀️", description: "Clear" });
		expect(describeWeather({ code: 63, isDay: true })).toEqual({ icon: "🌧️", description: "Rain" });
		expect(describeWeather({ code: 95, isDay: false })).toEqual({ icon: "⛈️", description: "Thunderstorms" });
	});

	it("uses a night icon where the day one would show the sun", () => {
		expect(describeWeather({ code: 0, isDay: false }).icon).toBe("🌙");
		expect(describeWeather({ code: 1, isDay: false }).icon).toBe("🌙");
		expect(describeWeather({ code: 80, isDay: false }).icon).toBe("🌧️");
		// Clouds look the same at night
		expect(describeWeather({ code: 3, isDay: false }).icon).toBe("☁️");
	});

	it("copes with a code it doesn't know", () => {
		expect(describeWeather({ code: 42, isDay: true })).toEqual({ icon: "❔", description: "Unknown conditions" });
	});
});

describe("representativeWeatherCode", () => {
	it("is undefined without any codes", () => {
		expect(representativeWeatherCode([])).toBeUndefined();
	});

	it("reports the typical cloud cover when that's all there is", () => {
		expect(representativeWeatherCode([0, 0, 1])).toBe(0);
		expect(representativeWeatherCode([0, 3, 3])).toBe(2);
	});

	it("lets significant weather win, highest code first", () => {
		expect(representativeWeatherCode([2, 61, 3])).toBe(61);
		expect(representativeWeatherCode([61, 95, 45])).toBe(95);
	});
});

describe("hourOfDay", () => {
	it("gives the local time of day in the requested zone", () => {
		expect(hourOfDay(at(10.5), "America/Los_Angeles")).toBe(10.5);
		expect(hourOfDay(at(10.5), "UTC")).toBe(17.5);
	});

	it("follows daylight saving time", () => {
		// 18:00 UTC is 10am PST in December, 11am PDT in September
		expect(hourOfDay(Date.UTC(2026, 11, 16, 18), "America/Los_Angeles")).toBe(10);
		expect(hourOfDay(Date.UTC(2026, 8, 16, 18), "America/Los_Angeles")).toBe(11);
	});
});

describe("filterSamplesToHours", () => {
	const samples = day({ temperature: hour => hour });
	const timeZone = "America/Los_Angeles";

	it("keeps reservation hours plus an hour either side", () => {
		const kept = filterSamplesToHours(samples, { timeZone, startHour: 10, endHour: 22 });
		expect(kept.map(s => s.temperature)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
	});

	it("handles a window that runs to midnight", () => {
		const kept = filterSamplesToHours(samples, { timeZone, startHour: 20, endHour: 24 });
		expect(kept.map(s => s.temperature)).toEqual([0, 1, 19, 20, 21, 22, 23]);
	});

	it("keeps everything for an all-day window", () => {
		expect(filterSamplesToHours(samples, { timeZone, startHour: 0, endHour: 24 })).toHaveLength(24);
	});
});

describe("valueAt", () => {
	const series = [
		{ time: at(10), value: 10 },
		{ time: at(11), value: 20 },
		{ time: at(15), value: 0 },
	];

	it("returns exact samples", () => {
		expect(valueAt(series, at(11))).toBe(20);
	});

	it("interpolates between samples", () => {
		expect(valueAt(series, at(10.25))).toBe(12.5);
	});

	it("doesn't extrapolate beyond the data", () => {
		expect(valueAt(series, at(9.5))).toBeUndefined();
		expect(valueAt(series, at(15.5))).toBeUndefined();
	});

	it("doesn't interpolate across a long gap", () => {
		expect(valueAt(series, at(13))).toBeUndefined();
	});
});

describe("summarizeDayWeather", () => {
	describe("temperature", () => {
		it("gives each slot's values, from border to border", () => {
			const summary = summarize(day({ temperature: hour => hour }));

			expect(summary.slots).toHaveLength(3);
			// 10:00-16:00: 7 hourly samples, spread evenly across the slot
			expect(summary.slots[0]?.temperature).toEqual(
				[10, 11, 12, 13, 14, 15, 16].map((value, i) => ({ position: i / 6, value })),
			);
			expect(summary.slots[1]?.temperature).toEqual([16, 17, 18, 19].map((value, i) => ({ position: i / 3, value })));
			// Night-time values are ignored
			expect(summary.temperatureMin).toBe(10);
			expect(summary.temperatureMax).toBe(22);
		});

		it("gives the temperature exactly at each border, even between samples", () => {
			const summary = summarize(day({ temperature: hour => hour * 2 }), [{ start: at(10.5), end: at(12.25) }]);
			const points = summary.slots[0]?.temperature ?? [];

			expect(points).toEqual([
				{ position: 0, value: 21 },
				{ position: 0.5 / 1.75, value: 22 },
				{ position: 1.5 / 1.75, value: 24 },
				{ position: 1, value: 24.5 },
			]);
			expect(valueAtEdge(points, 0)).toBe(21);
			expect(valueAtEdge(points, 1)).toBe(24.5);
		});

		it("skips missing values", () => {
			const summary = summarize(day({ temperature: hour => (hour === 12 ? null : 15) }));
			expect(summary.slots[0]?.temperature.map(p => p.position)).not.toContain(2 / 6);
		});

		it("is undefined when the forecast doesn't cover the day", () => {
			const tomorrow = Slots.map(({ start, end }) => ({ start: start + 24 * Hour, end: end + 24 * Hour }));
			expect(summarizeDayWeather(day(), tomorrow)).toBeUndefined();
			expect(summarizeDayWeather([], Slots)).toBeUndefined();
		});
	});

	describe("chance of rain", () => {
		it("takes the highest chance in any hour of the slot", () => {
			const summary = summarize(day({ rain: hour => (hour === 17 ? 60 : hour === 3 ? 100 : 5) }));

			expect(summary.slots.map(slot => slot.chanceOfRain)).toEqual([5, 60, 5]);
			// The 100% at 3am is outside reservation hours
			expect(summary.precipitationProbabilityMax).toBe(60);
		});

		it("counts each sample towards the hour before it", () => {
			// The sample at 16:00 is about 15:00-16:00, which is the first slot, not the second
			const summary = summarize(day({ rain: hour => (hour === 16 ? 90 : 10) }));
			expect(summary.slots.map(slot => slot.chanceOfRain)).toEqual([90, 10, 10]);
		});

		it("includes the hour that a slot ends partway through", () => {
			const summary = summarize(day({ rain: hour => (hour === 19 ? 70 : 0) }), [{ start: at(16), end: at(18.5) }]);
			expect(summary.slots[0]?.chanceOfRain).toBe(70);
		});

		it("draws each chance in the middle of the hour it's about", () => {
			const summary = summarize(day({ rain: hour => (hour === 17 ? 60 : 0) }));
			// The 60% for 16:00-17:00 peaks at 16:30, a sixth of the way through 4pm-7pm
			expect(summary.slots[1]?.precipitationProbability).toContainEqual({ position: 1 / 6, value: 60 });
			expect(valueRange(summary.slots[1]?.precipitationProbability ?? [])).toEqual({ min: 0, max: 60 });
		});

		it("is undefined without data", () => {
			const summary = summarize(day({ rain: () => null }));
			expect(summary.slots[0]?.chanceOfRain).toBeUndefined();
			expect(summary.slots[0]?.precipitationProbability).toEqual([]);
			expect(summary.precipitationProbabilityMax).toBeUndefined();
		});
	});

	describe("conditions", () => {
		it("describes the first and second half of each slot separately", () => {
			// First half of 10am-4pm is 10:00-13:00
			const summary = summarize(day({ code: hour => (hour < 13 ? 0 : 2) }));
			expect(summary.slots[0]?.conditions).toEqual([
				{ code: 0, isDay: true },
				{ code: 2, isDay: true },
			]);
		});

		it("lets an hour of rain speak for its half of the slot", () => {
			const summary = summarize(day({ code: hour => (hour === 12 ? 61 : 1) }));
			expect(summary.slots[0]?.conditions.map(c => c?.code)).toEqual([61, 1]);
		});

		it("knows when it's dark", () => {
			const summary = summarize(day({ isDay: hour => hour < 20 }));
			// 7pm-8:30pm is centered on 7:45pm, nearest the 8pm sample
			expect(summary.slots[2]?.conditions.map(c => c?.isDay)).toEqual([false, false]);
			expect(summary.slots[1]?.conditions.map(c => c?.isDay)).toEqual([true, true]);
		});

		it("uses the nearest sample for a half too short to contain one", () => {
			// 16:05-16:35: both halves are centered nearer 16:00 than 17:00
			const summary = summarize(day({ code: hour => (hour === 16 ? 3 : 0) }), [
				{ start: at(16 + 1 / 12), end: at(16 + 7 / 12) },
			]);
			expect(summary.slots[0]?.conditions.map(c => c?.code)).toEqual([3, 3]);
		});

		it("is undefined without data", () => {
			const summary = summarize(day({ code: () => null }));
			expect(summary.slots[0]?.conditions).toEqual([undefined, undefined]);
		});
	});
});

describe("valueRange", () => {
	it("finds the lowest and highest values", () => {
		expect(
			valueRange([
				{ position: 0, value: 3 },
				{ position: 0.5, value: -1 },
				{ position: 1, value: 7 },
			]),
		).toEqual({ min: -1, max: 7 });
	});

	it("is undefined without any values", () => {
		expect(valueRange([])).toBeUndefined();
	});
});

describe("buildSlotSparklines", () => {
	const size = { width: 100, height: 24, padding: 2 };

	/** [x, y] of each vertex in path data */
	function points(path: string | undefined) {
		return [...(path ?? "").matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
	}

	it("draws one line per slot, running linearly in time from edge to edge", () => {
		const sparklines = buildSlotSparklines(summarize(day({ temperature: hour => hour })), size);

		expect(sparklines).toHaveLength(3);
		// The 6-hour slot and the 3-hour slots each span the whole width
		expect(points(sparklines[0]?.temperature).map(([x]) => x)).toEqual([0, 16.67, 33.33, 50, 66.67, 83.33, 100]);
		expect(points(sparklines[1]?.temperature).map(([x]) => x)).toEqual([0, 33.33, 66.67, 100]);
		for (const sparkline of sparklines) expect(sparkline.temperature?.match(/M/g)).toHaveLength(1);
	});

	it("scales temperature to the whole day's range, inside the padding", () => {
		const sparklines = buildSlotSparklines(summarize(day({ temperature: hour => hour })), size);

		expect(points(sparklines[0]?.temperature)[0]).toEqual([0, 22]); // Coolest, at the bottom
		expect(points(sparklines[2]?.temperature).at(-1)).toEqual([100, 2]); // Warmest, at the top
		// Neighbouring slots meet at the same height
		expect(points(sparklines[0]?.temperature).at(-1)?.[1]).toBe(points(sparklines[1]?.temperature)[0]?.[1]);
	});

	it("keeps a nearly flat day looking flat", () => {
		const sparklines = buildSlotSparklines(
			summarize(day({ temperature: hour => 20 + (hour % 2) * (MinimumTemperatureSpan / 10) })),
			size,
		);

		for (const [, y] of sparklines.flatMap(s => points(s.temperature))) {
			expect(y).toBeGreaterThan(10);
			expect(y).toBeLessThan(14);
		}
	});

	it("carries each slot's closing value across the gap to the next, except after the last", () => {
		const sparklines = buildSlotSparklines(summarize(day({ temperature: hour => hour })), {
			...size,
			continuation: 100,
		});

		const first = points(sparklines[0]?.temperature);
		expect(first.at(-1)).toEqual([200, first.at(-2)?.[1]]);
		expect(points(sparklines[2]?.temperature).at(-1)?.[0]).toBe(100);
	});

	it("doesn't carry a line on from a slot whose data stops early", () => {
		// Nothing from 15:00 to 19:00 (too long a gap to interpolate across), so the first slot's line
		// ends before its border and the middle slot has no line at all
		const sparklines = buildSlotSparklines(
			summarize(day({ temperature: hour => (hour > 14 && hour < 20 ? null : hour) })),
			{ ...size, continuation: 100 },
		);

		expect(points(sparklines[0]?.temperature).at(-1)?.[0]).toBe(66.67);
		expect(sparklines[1]?.temperature).toBeUndefined();
	});

	it("draws chance of rain as a line with the area below it filled, on a fixed 0-100% scale", () => {
		// 50% from the hour ending 7pm, so from 6:30pm as drawn
		const sparklines = buildSlotSparklines(summarize(day({ rain: hour => (hour >= 19 ? 50 : 0) })), {
			...size,
			continuation: 100,
		});

		expect(sparklines[1]?.precipitation).toBe("M0 24L16.67 24L50 24L83.33 12L100 12L200 12");
		expect(sparklines[1]?.precipitationArea).toBe("M0 24L0 24L16.67 24L50 24L83.33 12L100 12L200 12L200 24Z");
		expect(sparklines[2]?.precipitation).toBe("M0 12L16.67 12L50 12L83.33 12L100 12");
		expect(sparklines[2]?.precipitationArea).toBe("M0 24L0 12L16.67 12L50 12L83.33 12L100 12L100 24Z");
	});

	it("leaves out chance of rain on a dry day", () => {
		for (const sparkline of buildSlotSparklines(summarize(day()), size)) {
			expect(sparkline.precipitation).toBeUndefined();
			expect(sparkline.precipitationArea).toBeUndefined();
		}
	});
});
