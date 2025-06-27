"use client";
import { useCallback, useEffect, useState } from "react";

export function useInterval<T>(generator: () => T, interval = 1000, deps: any[] = []) {
	if (typeof interval !== "number") throw new Error("Interval must be a number");
	if (interval < 1) throw new Error("Interval must be greater than 0");

	generator = useCallback(generator, deps);

	const [value, setValue] = useState(generator());
	useEffect(() => {
		const timer = setInterval(() => setValue(generator()), interval);
		return () => clearInterval(timer);
	}, [interval, generator]);
	return value;
}
