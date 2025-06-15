"use client";

import { useState, useCallback } from "react";
import { dateToLocalString } from "~/server/util/timeUtils";
import { PrettyTimeDelta } from "./PrettyTimeDelta";

export function RenderTime({ time }: { time: Date }) {
	const [useUserLocale, setUseUserLocale] = useState(false);
	const toggleUseUserLocale = useCallback(() => setUseUserLocale(prev => !prev), []);

	return (
		<div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "center", marginBottom: "1rem" }}>
			<span onClick={toggleUseUserLocale} onKeyDown={toggleUseUserLocale}>
				{useUserLocale ? time.toLocaleString() : dateToLocalString(time)}
			</span>
			<br />
			<PrettyTimeDelta date={time} />
		</div>
	);
}
