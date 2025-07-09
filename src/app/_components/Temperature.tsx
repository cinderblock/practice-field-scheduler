interface TemperatureProps {
	celsius: number;
	showUnit?: boolean;
	precision?: number;
}

/**
 * Temperature component that displays Celsius temperatures as Fahrenheit
 * @param celsius - Temperature in Celsius
 * @param showUnit - Whether to show the "°F" unit (default: true)
 * @param precision - Number of decimal places (default: 0)
 */
export default function Temperature({ celsius, showUnit = true, precision = 0 }: TemperatureProps) {
	const fahrenheit = (celsius * 9) / 5 + 32;
	const rounded = Number(fahrenheit.toFixed(precision));
	
	return (
		<span>
			{rounded}{showUnit && "°F"}
		</span>
	);
}