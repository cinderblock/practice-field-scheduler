import { celsiusToFahrenheit } from "~/server/util/weather";

// Temperatures are Celsius everywhere internally and only converted for display, here. When a unit
// preference is added, this is the one place that needs to know about it.

export type TemperatureStyle =
	/** "72°F" */
	| "full"
	/** "72°", where the unit is clear from context */
	| "short";

/** A whole-degree temperature for display */
export function formatTemperature(celsius: number, style: TemperatureStyle = "full"): string {
	const degrees = Math.round(celsiusToFahrenheit(celsius));
	return style === "full" ? `${degrees}°F` : `${degrees}°`;
}

export function Temperature({ celsius, style = "full" }: { celsius: number; style?: TemperatureStyle }) {
	return <>{formatTemperature(celsius, style)}</>;
}
