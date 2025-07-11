import { describe, expect, it } from "vitest";

// Simple temperature conversion function for testing
function celsiusToFahrenheit(celsius: number, precision = 0): number {
	const fahrenheit = (celsius * 9) / 5 + 32;
	return Number(fahrenheit.toFixed(precision));
}

describe("Temperature Conversion", () => {
	it("should convert 0°C to 32°F", () => {
		expect(celsiusToFahrenheit(0)).toBe(32);
	});

	it("should convert 20°C to 68°F", () => {
		expect(celsiusToFahrenheit(20)).toBe(68);
	});

	it("should convert 25°C to 77°F", () => {
		expect(celsiusToFahrenheit(25)).toBe(77);
	});

	it("should handle precision correctly", () => {
		expect(celsiusToFahrenheit(21, 1)).toBe(69.8);
	});

	it("should handle negative temperatures", () => {
		expect(celsiusToFahrenheit(-10)).toBe(14);
	});

	it("should handle fractional temperatures", () => {
		expect(celsiusToFahrenheit(23.5, 1)).toBe(74.3);
	});
});
