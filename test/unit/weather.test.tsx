import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Temperature } from "../../src/app/_components/Temperature";
import { WeatherIcon } from "../../src/app/_components/WeatherIcon";

describe("Temperature Component", () => {
	it("should convert celsius to fahrenheit correctly", () => {
		const { container } = render(<Temperature celsius={20} />);
		expect(container.textContent).toBe("68°F");
	});

	it("should round to nearest integer", () => {
		const { container } = render(<Temperature celsius={20.5} />);
		expect(container.textContent).toBe("69°F");
	});

	it("should handle negative temperatures", () => {
		const { container } = render(<Temperature celsius={-10} />);
		expect(container.textContent).toBe("14°F");
	});
});

describe("WeatherIcon Component", () => {
	it("should render correct emoji for clear weather", () => {
		const { container } = render(<WeatherIcon condition="clear" />);
		expect(container.textContent).toBe("☀️");
	});

	it("should render correct emoji for rain", () => {
		const { container } = render(<WeatherIcon condition="rain" />);
		expect(container.textContent).toBe("🌧️");
	});

	it("should render correct emoji for cloudy weather", () => {
		const { container } = render(<WeatherIcon condition="cloudy" />);
		expect(container.textContent).toBe("☁️");
	});
});
