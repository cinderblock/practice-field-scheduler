import React from "react";

interface TemperatureProps {
	celsius: number;
	showUnit?: boolean;
	className?: string;
}

/**
 * Temperature component that converts Celsius to Fahrenheit for display
 */
export function Temperature({ celsius, showUnit = true, className }: TemperatureProps) {
	const fahrenheit = Math.round((celsius * 9) / 5 + 32);

	return (
		<span className={className}>
			{fahrenheit}
			{showUnit && "°F"}
		</span>
	);
}
