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

export function isFutureDate(date: string) {
	return isValidDate(date) && new Date(date) > new Date();
}

export function isValidDate(date: string) {
	if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return false;

	if (!date.startsWith(new Date().getFullYear().toString())) return false;

	if (Number.isNaN(new Date(date).getTime())) return false;

	return true;
}

export function isValidTime(time: string) {
	return /^([01]?[0-9]|2[0-3]):[0-5][0-9](am|pm)$/.test(time);
}

export function isValidTimeSlot(timeSlot: string) {
	const [date, time] = timeSlot.split(" ");
	if (!date || !time) return false;
	return isValidDate(date) && isValidTime(time);
}
