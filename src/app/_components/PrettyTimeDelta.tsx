"use client";

import { useInterval } from "./useInterval";

export function PrettyTimeDelta({ date }: { date: Date }) {
	const now = useInterval(() => new Date(), 1000);
	const delta = now.getTime() - date.getTime();
	const formatted = `${formatTimeDelta(delta)} ago`.replace(" ", "\u00A0");
	return <span suppressHydrationWarning>{formatted}</span>;
}

function formatTimeDelta(ms: number): string {
	let seconds = Math.floor(ms / 1000);
	let minutes = Math.floor(seconds / 60);
	seconds = seconds % 60;
	let hours = Math.floor(minutes / 60);
	minutes = minutes % 60;
	let days = Math.floor(hours / 24);
	hours = hours % 24;
	const weeks = Math.floor(days / 7);
	days = days % 7;

	if (weeks > 0) return `${weeks}w ${days}d`;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}
