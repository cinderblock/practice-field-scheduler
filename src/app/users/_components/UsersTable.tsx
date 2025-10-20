"use client";

import Image from "next/image";
import { useState } from "react";
import { TeamAvatar } from "~/app/_components/TeamAvatar";
import { dateToDateString } from "~/server/util/timeUtils";
import type { UserEntry } from "~/types";
import styles from "./UsersTable.module.css";

type User = Omit<Pick<UserEntry, "id" | "name" | "displayName" | "image" | "created" | "teams">, "teams"> & {
	teams: UserEntry["teams"];
	isAdmin: boolean;
};

type SortField = "name" | "created";
type SortDirection = "asc" | "desc";

export function UsersTable({ users, isAdmin }: { users: User[]; isAdmin: boolean }) {
	const [sortField, setSortField] = useState<SortField>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
	const [showAdmins, setShowAdmins] = useState(true);

	// Get unique teams from all users
	const allTeams = Array.from(
		new Set(users.filter(user => user.teams !== "admin").flatMap(user => user.teams as number[])),
	).sort((a, b) => a - b);

	const sortedUsers = [...users].sort((a, b) => {
		// Always sort admins to the top
		if (a.teams === "admin" && b.teams !== "admin") return -1;
		if (a.teams !== "admin" && b.teams === "admin") return 1;

		const aValue = a[sortField];
		const bValue = b[sortField];

		if (sortField === "created") {
			const aDate = new Date(aValue);
			const bDate = new Date(bValue);
			return sortDirection === "asc" ? aDate.getTime() - bDate.getTime() : bDate.getTime() - aDate.getTime();
		}

		return sortDirection === "asc"
			? String(aValue).localeCompare(String(bValue))
			: String(bValue).localeCompare(String(aValue));
	});

	// Filter users by selected team and admin status
	const filteredUsers = sortedUsers.filter(user => {
		if (user.teams === "admin") return showAdmins;
		if (selectedTeam === null) return true;
		return (user.teams as number[]).includes(selectedTeam);
	});

	const toggleSort = (field: SortField) => {
		if (field === sortField) {
			setSortDirection(sortDirection === "asc" ? "desc" : "asc");
		} else {
			setSortField(field);
			setSortDirection("asc");
		}
	};

	return (
		<div>
			<div className={styles.filterLabel}>Filters</div>
			<div className={styles.filterBox}>
				<div className={styles.filterContainer}>
					<button
						type="button"
						className={`${styles.teamFilterButton} ${showAdmins ? styles.teamFilterButtonSelected : ""}`}
						onClick={() => setShowAdmins(!showAdmins)}
						title={showAdmins ? "Hide Admins" : "Show Admins"}
						data-team="Admins"
					>
						<div className={styles.adminIcon}>{showAdmins ? "👾" : "⭐"}</div>
					</button>
					{allTeams.map(team => (
						<button
							key={team}
							type="button"
							className={`${styles.teamFilterButton} ${selectedTeam === team ? styles.teamFilterButtonSelected : ""}`}
							onClick={() => setSelectedTeam(selectedTeam === team ? null : team)}
							title={selectedTeam === team ? `Hide Team ${team}` : `Show Team ${team}`}
							data-team={`Team ${team}`}
						>
							<TeamAvatar teamNumber={team} size="2em" />
						</button>
					))}
				</div>
			</div>
			<div className={styles.tableContainer}>
				<table className={styles.usersTable}>
					<thead>
						<tr>
							<th style={{ width: "1%" }} />
							<th>
								<button type="button" onClick={() => toggleSort("name")}>
									Name {sortField === "name" && (sortDirection === "asc" ? "↑" : "↓")}
								</button>
							</th>
							{isAdmin && <th>Teams</th>}
							<th>
								<button type="button" onClick={() => toggleSort("created")}>
									Created {sortField === "created" && (sortDirection === "asc" ? "↑" : "↓")}
								</button>
							</th>
						</tr>
					</thead>
					<tbody>
						{filteredUsers.map(user => (
							<tr key={user.id}>
								<td>
									<div className={styles.userCell}>
										<div style={{ position: "relative", width: "40px", height: "40px" }}>
											<Image
												src={user.image}
												alt={`${user.displayName ?? user.name}'s profile`}
												className={styles.userImage}
												fill
												sizes="40px"
												unoptimized
											/>
										</div>
									</div>
								</td>
								<td>
									<div className={styles.userName} title={user.displayName && user.name ? user.name : undefined}>
										{user.displayName ?? user.name}
										{user.displayName && user.name && (
											<div style={{ fontSize: "0.85em", color: "var(--text-secondary)", fontWeight: "normal" }}>
												{user.name}
											</div>
										)}
									</div>
								</td>
								{isAdmin && (
									<td>
										<div className={styles.teamsCell}>
											{user.teams === "admin"
												? "Admin"
												: user.teams.map(team => (
														<div key={team} className={styles.teamAvatar} data-team={`Team ${team}`}>
															<TeamAvatar teamNumber={team} size="1.5em" />
														</div>
													))}
										</div>
									</td>
								)}
								<td>
									<div className={styles.dateCell}>{dateToDateString(user.created)}</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
