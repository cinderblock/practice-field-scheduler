"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import type { Holiday } from "~/types";
import styles from "./HolidaysTable.module.css";

interface HolidaysTableProps {
	holidays: Holiday[];
}

export function HolidaysTable({ holidays: initialHolidays }: HolidaysTableProps) {
	const [isAdding, setIsAdding] = useState(false);
	const [newHoliday, setNewHoliday] = useState({
		name: "",
		date: "",
		icon: "",
		url: "",
	});

	const utils = api.useUtils();
	const { data: holidays = initialHolidays } = api.holiday.list.useQuery(undefined, {
		initialData: initialHolidays,
	});

	const addHoliday = api.holiday.add.useMutation({
		onSuccess: () => {
			utils.holiday.list.invalidate();
			setIsAdding(false);
			setNewHoliday({ name: "", date: "", icon: "", url: "" });
		},
	});

	const removeHoliday = api.holiday.remove.useMutation({
		onSuccess: () => {
			utils.holiday.list.invalidate();
		},
	});

	const handleAddHoliday = () => {
		if (!newHoliday.name || !newHoliday.date || !newHoliday.icon) return;

		addHoliday.mutate({
			name: newHoliday.name,
			date: newHoliday.date,
			icon: newHoliday.icon,
			url: newHoliday.url || undefined,
		});
	};

	const handleRemoveHoliday = (id: string) => {
		if (confirm("Are you sure you want to remove this holiday?")) {
			removeHoliday.mutate({ id });
		}
	};

	// Sort holidays by date
	const sortedHolidays = [...holidays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

	return (
		<div className={styles.container}>
			<div className={styles.header}>
				<h2>Manage Holidays</h2>
				<button
					type="button"
					className={styles.addButton}
					onClick={() => setIsAdding(!isAdding)}
					disabled={addHoliday.isPending}
				>
					{isAdding ? "Cancel" : "Add Holiday"}
				</button>
			</div>

			{isAdding && (
				<div className={styles.addForm}>
					<h3>Add New Holiday</h3>
					<div className={styles.formRow}>
						<label htmlFor="name">Name:</label>
						<input
							id="name"
							type="text"
							value={newHoliday.name}
							onChange={e => setNewHoliday(prev => ({ ...prev, name: e.target.value }))}
							placeholder="e.g., New Year's Day"
						/>
					</div>
					<div className={styles.formRow}>
						<label htmlFor="date">Date:</label>
						<input
							id="date"
							type="date"
							value={newHoliday.date}
							onChange={e => setNewHoliday(prev => ({ ...prev, date: e.target.value }))}
							min={`${new Date().getFullYear()}-01-01`}
							max={`${new Date().getFullYear()}-12-31`}
						/>
					</div>
					<div className={styles.formRow}>
						<label htmlFor="icon">Icon:</label>
						<input
							id="icon"
							type="text"
							value={newHoliday.icon}
							onChange={e => setNewHoliday(prev => ({ ...prev, icon: e.target.value }))}
							placeholder="🎉"
						/>
					</div>
					<div className={styles.formRow}>
						<label htmlFor="url">URL (optional):</label>
						<input
							id="url"
							type="url"
							value={newHoliday.url}
							onChange={e => setNewHoliday(prev => ({ ...prev, url: e.target.value }))}
							placeholder="https://example.com"
						/>
					</div>
					<div className={styles.formActions}>
						<button
							type="button"
							className={styles.saveButton}
							onClick={handleAddHoliday}
							disabled={addHoliday.isPending || !newHoliday.name || !newHoliday.date || !newHoliday.icon}
						>
							{addHoliday.isPending ? "Adding..." : "Add Holiday"}
						</button>
						<button
							type="button"
							className={styles.cancelButton}
							onClick={() => {
								setIsAdding(false);
								setNewHoliday({ name: "", date: "", icon: "", url: "" });
							}}
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			<div className={styles.holidaysList}>
				<h3>Current Holidays</h3>
				{sortedHolidays.length === 0 ? (
					<p className={styles.emptyMessage}>No holidays configured.</p>
				) : (
					<div className={styles.holidayGrid}>
						{sortedHolidays.map(holiday => (
							<div key={holiday.id} className={styles.holidayCard}>
								{holiday.url ? (
									<a
										href={holiday.url}
										target="_blank"
										rel="noopener noreferrer"
										className={styles.holidayIconLink}
										title={`${holiday.name} - Click for more info`}
									>
										<div className={styles.holidayIcon}>{holiday.icon}</div>
									</a>
								) : (
									<div className={styles.holidayIcon}>{holiday.icon}</div>
								)}
								<div className={styles.holidayInfo}>
									<div className={styles.holidayName}>{holiday.name}</div>
									<div className={styles.holidayDate}>
										{new Date(`${holiday.date}T00:00`).toLocaleDateString("en-US", {
											weekday: "long",
											year: "numeric",
											month: "long",
											day: "numeric",
										})}
									</div>
									{holiday.url && (
										<a href={holiday.url} target="_blank" rel="noopener noreferrer" className={styles.holidayUrl}>
											More info
										</a>
									)}
								</div>
								<button
									type="button"
									className={styles.removeButton}
									onClick={() => handleRemoveHoliday(holiday.id)}
									disabled={removeHoliday.isPending}
									title="Remove holiday"
								>
									×
								</button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
