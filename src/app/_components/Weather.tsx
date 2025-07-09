import { api } from "~/trpc/react";
import Temperature from "./Temperature";
import styles from "./Weather.module.css";

interface WeatherProps {
	date: string;
	startHour: number;
	endHour: number;
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

export default function Weather({ date, startHour, endHour }: WeatherProps) {
	const { data: isEnabled } = api.weather.isEnabled.useQuery();
	const { data: weatherData } = api.weather.getWeatherForTimeSlot.useQuery(
		{ date, startHour, endHour },
		{ enabled: !!isEnabled },
	);

	if (!isEnabled || !weatherData) {
		return null;
	}

	const duration = endHour - startHour;
	const showMiddle = duration > 2; // Only show middle temp for slots longer than 2 hours

	return (
		<div className={styles.weatherContainer}>
			<div className={styles.weatherIcon}>{getWeatherIcon(weatherData.weatherCode)}</div>
			<div className={styles.temperatures}>
				<span className={styles.tempStart}>
					<Temperature celsius={weatherData.startTemp} />
				</span>
				{showMiddle && (
					<span className={styles.tempMiddle}>
						<Temperature celsius={weatherData.middleTemp} />
					</span>
				)}
				{startHour !== endHour && (
					<span className={styles.tempEnd}>
						<Temperature celsius={weatherData.endTemp} />
					</span>
				)}
			</div>
		</div>
	);
}
