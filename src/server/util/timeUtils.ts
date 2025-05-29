export function dateToTime(date: Date) {
	return date
		.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
		.replace(" AM", "am")
		.replace(" PM", "pm")
		.replace(" ", "\u00A0");
}

export function dateToDateString(date: Date) {
	const y = date.getFullYear();
	const m = date.getMonth() + 1;
	const d = date.getDate();
	const yyyy = y.toString().padStart(4, "0");
	const mm = m.toString().padStart(2, "0");
	const dd = d.toString().padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export function dateToTimeSlotString(date: Date) {
	const d = dateToDateString(date);
	const t = dateToTime(date);
	return `${d} ${t}`;
}
export function dateToLocalString(date: Date) {
	return date
		.toLocaleString("en-US", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: true,
			timeZoneName: "short",
		})
		.replace(
			/(\d+)\/(\d+)\/(\d+),\s(\d+):(\d+):(\d+)\s(AM|PM)\s(.+)/,
			(_, m, d, y, h, min, s, ampm, tz) => `${y}-${m}-${d} ${h}:${min}:${s}${ampm.toLowerCase()} ${tz}`,
		);
}
