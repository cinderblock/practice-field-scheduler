import type { WeatherCondition } from "~/types";

interface WeatherIconProps {
	condition: WeatherCondition;
	size?: number;
	className?: string;
}

export function WeatherIcon({ condition, size = 16, className }: WeatherIconProps) {
	const getWeatherEmoji = (condition: WeatherCondition): string => {
		switch (condition) {
			case "clear":
				return "☀️";
			case "partly_cloudy":
				return "⛅";
			case "cloudy":
				return "☁️";
			case "rain":
				return "🌧️";
			case "snow":
				return "❄️";
			case "thunderstorm":
				return "⛈️";
			case "fog":
				return "🌫️";
			case "wind":
				return "💨";
			default:
				return "🌤️";
		}
	};

	return (
		<span className={className} style={{ fontSize: `${size}px` }} title={condition.replace("_", " ")}>
			{getWeatherEmoji(condition)}
		</span>
	);
}
