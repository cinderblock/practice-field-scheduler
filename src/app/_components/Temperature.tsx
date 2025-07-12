import type { CSSProperties } from "react";

interface TemperatureProps {
	celsius: number;
	style?: CSSProperties;
	className?: string;
}

export function Temperature({ celsius, style, className }: TemperatureProps) {
	// Convert Celsius to Fahrenheit
	const fahrenheit = Math.round((celsius * 9) / 5 + 32);

	return (
		<span style={style} className={className}>
			{fahrenheit}°F
		</span>
	);
}
