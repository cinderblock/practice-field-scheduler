"use client";

import { useMemo, useState } from "react";
import { dateToLocalString } from "~/server/util/timeUtils";
import styles from "./LogsTable.module.css";

type LogEntry = {
	timestamp: Date;
	ip: string;
	userAgent: string;
	userId: string;
	userName: string;
	type: string;
	date?: string;
	slot?: number;
	team?: number;
	notes?: string;
	reason?: string;
	name?: string;
	teams?: number[] | "admin";
};

export function LogsTable({ logs }: { logs: LogEntry[] }) {
	const [selectedType, setSelectedType] = useState<string | null>(null);
	const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
	const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
	const [selectedDate, setSelectedDate] = useState<string | null>(null);
	const [selectedUser, setSelectedUser] = useState<string | null>(null);
	const [teamInput, setTeamInput] = useState<string>("");

	// Get unique values from logs
	const types = Array.from(new Set(logs.map(log => log.type))).sort();
	const slots = Array.from(
		new Set(
			logs
				.filter(log => log.slot !== undefined)
				.map(log => log.slot)
				.filter((slot): slot is number => slot !== undefined),
		),
	).sort((a, b) => a - b);
	const users = Array.from(new Set(logs.map(log => log.userName))).sort();

	// Calculate date restrictions
	const { availableDates, minDate, maxDate } = useMemo(() => {
		const dates = new Set<string>();
		let min: string | undefined;
		let max: string | undefined;

		for (const log of logs) {
			if (log.date) {
				dates.add(log.date);
				if (!min || log.date < min) min = log.date;
				if (!max || log.date > max) max = log.date;
			}
		}

		return {
			availableDates: Array.from(dates).sort(),
			minDate: min,
			maxDate: max,
		};
	}, [logs]);

	// Filter logs based on selected filters
	const filteredLogs = logs.filter(log => {
		if (selectedType && log.type !== selectedType) return false;
		if (selectedSlot && log.slot !== selectedSlot) return false;
		if (selectedDate && log.date !== selectedDate) return false;
		if (selectedUser && log.userName !== selectedUser) return false;
		if (selectedTeam) {
			// Search for team number in various fields
			const teamStr = selectedTeam.toString();
			const logStr = JSON.stringify(log).toLowerCase();
			if (!logStr.includes(teamStr)) return false;
		}
		return true;
	});

	const handleTeamInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setTeamInput(value);
		const num = Number.parseInt(value, 10);
		setSelectedTeam(Number.isNaN(num) ? null : num);
	};

	const clearDate = () => {
		setSelectedDate(null);
	};

	const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newDate = e.target.value;
		if (!newDate || availableDates.includes(newDate)) {
			setSelectedDate(newDate || null);
		}
	};

	return (
		<div>
			<div className={styles.filterLabel}>Filters</div>
			<div className={styles.filterBox}>
				<div className={styles.filterContainer}>
					<select
						value={selectedType ?? ""}
						onChange={e => setSelectedType(e.target.value || null)}
						className={styles.filterSelect}
					>
						<option value="">All Types</option>
						{types.map(type => (
							<option key={type} value={type}>
								{type}
							</option>
						))}
					</select>

					<select
						value={selectedUser ?? ""}
						onChange={e => setSelectedUser(e.target.value || null)}
						className={styles.filterSelect}
					>
						<option value="">All Users</option>
						{users.map(user => (
							<option key={user} value={user}>
								{user}
							</option>
						))}
					</select>

					<div className={styles.filterInputGroup}>
						<label htmlFor="teamInput" className={styles.filterInputLabel}>
							Team Number
						</label>
						<input
							id="teamInput"
							type="number"
							value={teamInput}
							onChange={handleTeamInputChange}
							placeholder="Enter team number"
							className={styles.filterInput}
						/>
					</div>

					<select
						value={selectedSlot ?? ""}
						onChange={e => setSelectedSlot(e.target.value ? Number(e.target.value) : null)}
						className={styles.filterSelect}
					>
						<option value="">All Time Slots</option>
						{slots.map(slot => (
							<option key={slot} value={slot}>
								Slot {slot}
							</option>
						))}
					</select>

					<div className={styles.filterInputGroup}>
						<label htmlFor="dateInput" className={styles.filterInputLabel}>
							Date
						</label>
						<div className={styles.dateInputContainer}>
							<input
								id="dateInput"
								type="date"
								value={selectedDate ?? ""}
								onChange={handleDateChange}
								min={minDate}
								max={maxDate}
								className={styles.filterInput}
								list="availableDates"
							/>
							<datalist id="availableDates">
								{availableDates.map(date => (
									<option key={date} value={date} />
								))}
							</datalist>
							{selectedDate && (
								<button type="button" onClick={clearDate} className={styles.clearButton} title="Clear date">
									×
								</button>
							)}
						</div>
					</div>
				</div>
			</div>

			<div className={styles.tableContainer}>
				<table className={styles.logsTable}>
					<thead>
						<tr>
							<th>Time</th>
							<th>Type</th>
							<th>Details</th>
							<th>User</th>
							<th>IP</th>
						</tr>
					</thead>
					<tbody>
						{filteredLogs.map(log => (
							<tr
								key={`${log.timestamp}-${log.userId}-${log.type}-${log.date ?? ""}-${log.slot ?? ""}-${log.team ?? ""}`}
							>
								<td className={styles.timeCell}>{dateToLocalString(new Date(log.timestamp))}</td>
								<td className={styles.typeCell}>{log.type}</td>
								<td className={styles.detailsCell}>
									{log.date && log.slot !== undefined ? (
										<div>
											Slot: {log.date} {log.slot}
										</div>
									) : log.date ? (
										<div>Date: {log.date}</div>
									) : (
										<div>Slot: {log.slot}</div>
									)}
									{log.team !== undefined && <div>Team: {log.team}</div>}
									{log.notes && <div>Notes: {log.notes}</div>}
									{log.reason && <div>Reason: {log.reason}</div>}
									{log.name && <div>Name: {log.name}</div>}
									{log.teams && <div>Teams: {log.teams === "admin" ? "Admin" : log.teams.join(", ")}</div>}
								</td>
								<td className={styles.userCell}>{log.userName}</td>
								<td className={styles.ipCell}>{log.ip}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
