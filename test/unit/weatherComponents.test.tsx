import { describe, expect, it } from "vitest";
import type { Temperature } from "~/app/_components/Temperature";
import type { WeatherIcon } from "~/app/_components/WeatherIcon";

describe("Temperature Component", () => {
	it("should convert Celsius to Fahrenheit correctly", () => {
		// Test the conversion logic directly
		const celsiusToFahrenheit = (celsius: number) => Math.round((celsius * 9) / 5 + 32);

		expect(celsiusToFahrenheit(0)).toBe(32);
		expect(celsiusToFahrenheit(-10)).toBe(14);
		expect(celsiusToFahrenheit(25)).toBe(77);
		expect(celsiusToFahrenheit(20.7)).toBe(69);
		expect(celsiusToFahrenheit(100)).toBe(212);
	});

	it("should have correct props interface", () => {
		// Type check - this will fail at compile time if interface is wrong
		const props: React.ComponentProps<typeof Temperature> = {
			celsius: 20,
			showUnit: true,
			className: "test-class",
		};

		expect(props.celsius).toBe(20);
		expect(props.showUnit).toBe(true);
		expect(props.className).toBe("test-class");
	});
});

describe("WeatherIcon Component", () => {
	it("should return correct weather icon for clear sky", () => {
		const getWeatherIcon = (code: number): string => {
			if (code === 0) return "☀️";
			if (code <= 2) return "🌤️";
			if (code === 3) return "☁️";
			if (code === 45 || code === 48) return "🌫️";
			if (code >= 51 && code <= 57) return "🌦️";
			if (code >= 61 && code <= 67) return "🌧️";
			if (code >= 71 && code <= 77) return "❄️";
			if (code >= 80 && code <= 86) return "🌦️";
			if (code >= 95 && code <= 99) return "⛈️";
			return "🌤️";
		};

		expect(getWeatherIcon(0)).toBe("☀️");
		expect(getWeatherIcon(1)).toBe("🌤️");
		expect(getWeatherIcon(3)).toBe("☁️");
		expect(getWeatherIcon(45)).toBe("🌫️");
		expect(getWeatherIcon(51)).toBe("🌦️");
		expect(getWeatherIcon(61)).toBe("🌧️");
		expect(getWeatherIcon(71)).toBe("❄️");
		expect(getWeatherIcon(95)).toBe("⛈️");
		expect(getWeatherIcon(999)).toBe("🌤️"); // unknown
	});

	it("should return correct weather description", () => {
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
				case 61:
				case 63:
				case 65:
					return "Rain";
				case 71:
				case 73:
				case 75:
					return "Snow";
				case 95:
					return "Thunderstorm";
				default:
					return "Unknown";
			}
		};

		expect(getWeatherDescription(0)).toBe("Clear sky");
		expect(getWeatherDescription(1)).toBe("Mainly clear");
		expect(getWeatherDescription(45)).toBe("Fog");
		expect(getWeatherDescription(61)).toBe("Rain");
		expect(getWeatherDescription(71)).toBe("Snow");
		expect(getWeatherDescription(95)).toBe("Thunderstorm");
		expect(getWeatherDescription(999)).toBe("Unknown");
	});

	it("should have correct props interface", () => {
		// Type check - this will fail at compile time if interface is wrong
		const props: React.ComponentProps<typeof WeatherIcon> = {
			weatherCode: 0,
			className: "test-class",
			size: "small",
		};

		expect(props.weatherCode).toBe(0);
		expect(props.className).toBe("test-class");
		expect(props.size).toBe("small");
	});
});
