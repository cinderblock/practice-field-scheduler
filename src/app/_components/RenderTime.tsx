"use client";

import { useCallback, useState } from "react";
import { dateToLocalString } from "~/server/util/timeUtils";
import { PrettyTimeDelta } from "./PrettyTimeDelta";

export function RenderTime({ time }: { time: Date }) {
	const [useUserLocale, setUseUserLocale] = useState(false);
	const toggleUseUserLocale = useCallback(() => setUseUserLocale(prev => !prev), []);

	const displayTime = useUserLocale ? time.toLocaleString() : dateToLocalString(time);

	return (
		<div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "center", marginBottom: "1rem" }}>
			<button
				type="button"
				onClick={toggleUseUserLocale}
				style={{
					cursor: "pointer",
					background: "none",
					border: "none",
					padding: 0,
					font: "inherit",
					color: "inherit",
					textAlign: "center",
				}}
			>
				{displayTime}
			</button>
			<br />
			<PrettyTimeDelta date={time} />
		</div>
	);
}
