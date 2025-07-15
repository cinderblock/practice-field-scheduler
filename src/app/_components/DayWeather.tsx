import { api } from "~/trpc/react";
import styles from "./DayWeather.module.css";
import Temperature from "./Temperature";

interface DayWeatherProps {
	date: string;
	timeSlotBorders: number[]; // Array of time slot boundaries (e.g., [13, 16, 19, 22])
}

// Weather code to icon mapping (WMO Weather interpretation codes)
function getWeatherIcon(weatherCode: number): string {
	// Simplified weather code mapping
	if (weatherCode === 0) return "☀️"; // Clear sky
	if (weatherCode >= 1 && weatherCode <= 3) return "⛅"; // Partly cloudy
	if (weatherCode >= 45 && weatherCode <= 48) return "🌫️"; // Fog
	if (weatherCode >= 51 && weatherCode <= 67) return "🌧️"; // Rain
	if (weatherCode >= 71 && weatherCode <= 77) return "❄️"; // Snow
	if (weatherCode >= 80 && weatherCode <= 82) return "🌦️"; // Rain showers
	if (weatherCode >= 95 && weatherCode <= 99) return "⛈️"; // Thunderstorm
	return "🌤️"; // Default
}

export default function DayWeather({ date, timeSlotBorders }: DayWeatherProps) {
	const { data: isEnabled } = api.weather.isEnabled.useQuery();
	const { data: weatherData } = api.weather.getWeatherForDate.useQuery({ date }, { enabled: !!isEnabled });

	if (!isEnabled || !weatherData) {
		return null;
	}

	// Convert time slot borders to actual hours (adding 12 for PM times)
	const actualHours = timeSlotBorders.map(border => border + 12);
	const numSlots = timeSlotBorders.length - 1;

	return (
		<div className={styles.dayWeatherContainer}>
			<div
				className={styles.temperatureRow}
				style={
					{
						"--columns": numSlots,
						gridTemplateColumns: `repeat(${numSlots}, 1fr)`,
					} as React.CSSProperties & { "--columns": number }
				}
			>
				{actualHours.map((hour, index) => {
					const temp = weatherData.hourlyTemperatures[hour] || 0;
					const weatherCode = weatherData.weatherCodes[hour] || 0;
					const isLast = index === actualHours.length - 1;

					return (
						<div key={hour} className={styles.timeSlotWeather}>
							<div className={styles.temperature}>
								<Temperature celsius={temp} />
							</div>
							{!isLast && (
								<div className={styles.weatherIconContainer}>
									<div className={styles.weatherIcon}>{getWeatherIcon(weatherCode)}</div>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
