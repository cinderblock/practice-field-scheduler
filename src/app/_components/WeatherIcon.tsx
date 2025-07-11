import React from "react";

interface WeatherIconProps {
	weatherCode: number;
	className?: string;
	size?: "small" | "medium" | "large";
}

/**
 * Weather icon component that displays weather conditions based on WMO weather codes
 */
export function WeatherIcon({ weatherCode, className = "", size = "medium" }: WeatherIconProps) {
	const sizeClasses = {
		small: "w-4 h-4 text-xs",
		medium: "w-5 h-5 text-sm",
		large: "w-6 h-6 text-base",
	};

	const getWeatherIcon = (code: number): string => {
		// Clear sky conditions
		if (code === 0) return "☀️"; // Clear sky
		if (code <= 2) return "🌤️"; // Mainly clear to partly cloudy
		if (code === 3) return "☁️"; // Overcast

		// Fog conditions
		if (code === 45 || code === 48) return "🌫️"; // Fog

		// Drizzle conditions
		if (code >= 51 && code <= 57) return "🌦️"; // Drizzle

		// Rain conditions
		if (code >= 61 && code <= 67) return "🌧️"; // Rain

		// Snow conditions
		if (code >= 71 && code <= 77) return "❄️"; // Snow

		// Showers
		if (code >= 80 && code <= 86) return "🌦️"; // Showers

		// Thunderstorm conditions
		if (code >= 95 && code <= 99) return "⛈️"; // Thunderstorm

		// Default for unknown codes
		return "🌤️";
	};

	const getWeatherDescription = (code: number): string => {
		switch (code) {
			case 0:
				return "Clear sky";
			case 1:
				return "Mainly clear";
			case 2:
				return "Partly cloudy";
			case 3:
				return "Overcast";
			case 45:
			case 48:
				return "Fog";
			case 51:
			case 53:
			case 55:
				return "Drizzle";
			case 56:
			case 57:
				return "Freezing drizzle";
			case 61:
			case 63:
			case 65:
				return "Rain";
			case 66:
			case 67:
				return "Freezing rain";
			case 71:
			case 73:
			case 75:
				return "Snow";
			case 77:
				return "Snow grains";
			case 80:
			case 81:
			case 82:
				return "Rain showers";
			case 85:
			case 86:
				return "Snow showers";
			case 95:
				return "Thunderstorm";
			case 96:
			case 99:
				return "Thunderstorm with hail";
			default:
				return "Unknown";
		}
	};

	const icon = getWeatherIcon(weatherCode);
	const description = getWeatherDescription(weatherCode);

	return (
		<span
			className={`inline-block ${sizeClasses[size]} ${className}`}
			title={description}
			role="img"
			aria-label={description}
		>
			{icon}
		</span>
	);
}
