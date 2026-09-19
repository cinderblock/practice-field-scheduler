"use client";

import Image from "next/image";
import { useState } from "react";
import { TeamAvatar } from "~/app/_components/TeamAvatar";
import { describeSlackNameIssue, type SlackNameIssue } from "~/server/util/slackName";
import { dateToDateString } from "~/server/util/timeUtils";
import { api } from "~/trpc/react";
import type { UserEntry } from "~/types";
import ui from "./adminUi.module.css";
import { GeneralAccessControls } from "./GeneralAccessControls";
import styles from "./UsersTable.module.css";

type User = Omit<Pick<UserEntry, "id" | "name" | "displayName" | "image" | "created" | "teams">, "teams"> & {
	teams: UserEntry["teams"];
	isAdmin: boolean;
};

type SortField = "name" | "created";

/** Why this person's gate links are held, if they are. Admin-only. */
function NameIssues({ issues }: { issues: readonly SlackNameIssue[] }) {
	if (issues.length === 0) return null;
	if (issues.includes("unverified")) {
		return (
			<div className={styles.nameIssues}>
				<span className={`${ui.chip} ${ui.chipMuted}`}>Names not checked with Slack</span>
			</div>
		);
	}
	return (
		<div className={styles.nameIssues}>
			<span className={`${ui.chip} ${ui.chipWarn}`}>Gate links on hold</span>
			<ul className={styles.issueList}>
				{issues.map(issue => (
					<li key={issue}>{describeSlackNameIssue(issue)}</li>
				))}
			</ul>
		</div>
	);
}
type SortDirection = "asc" | "desc";

export function UsersTable({ users, isAdmin }: { users: User[]; isAdmin: boolean }) {
	const [sortField, setSortField] = useState<SortField>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
	const [showAdmins, setShowAdmins] = useState(true);

	// Admin-only: general gate access status per user.
	const personalLinks = api.access.personal.list.useQuery(undefined, { enabled: isAdmin });
	const accessConfig = api.access.config.useQuery(undefined, { enabled: isAdmin });

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
						aria-label={showAdmins ? "Hide admins" : "Show admins"}
						aria-pressed={showAdmins}
						data-team="Admins"
					>
						<div className={styles.adminIcon}>{showAdmins ? "👾" : "⭐"}</div>
						<span className={styles.filterText}>Admins</span>
					</button>
					{allTeams.map(team => (
						<button
							key={team}
							type="button"
							className={`${styles.teamFilterButton} ${selectedTeam === team ? styles.teamFilterButtonSelected : ""}`}
							onClick={() => setSelectedTeam(selectedTeam === team ? null : team)}
							aria-label={selectedTeam === team ? "Show all teams" : `Show only Team ${team}`}
							aria-pressed={selectedTeam === team}
							data-team={`Team ${team}`}
						>
							<TeamAvatar teamNumber={team} size="2em" />
							<span className={styles.filterText}>{team}</span>
						</button>
					))}
				</div>
			</div>
			{isAdmin && (
				<p className={ui.note}>
					<strong>Teams</strong> come from the parentheses in each person's Slack display name, read from Slack — so
					they're empty until that person's names have been checked (their next visit, or <strong>Check now</strong>{" "}
					above). <strong>General gate access</strong> is an explicit grant; admins have it by being admins.
				</p>
			)}
			<div className={styles.tableContainer}>
				<table className={styles.usersTable}>
					<thead>
						<tr>
							<th className={styles.avatarCol} />
							<th className={styles.nameCol}>
								<button type="button" onClick={() => toggleSort("name")}>
									Name {sortField === "name" && (sortDirection === "asc" ? "↑" : "↓")}
								</button>
							</th>
							{isAdmin && <th className={styles.gateCol}>General gate access</th>}
							{isAdmin && <th className={styles.teamsCol}>Teams</th>}
							<th className={styles.createdCol}>
								<button type="button" onClick={() => toggleSort("created")}>
									Created {sortField === "created" && (sortDirection === "asc" ? "↑" : "↓")}
								</button>
							</th>
						</tr>
					</thead>
					<tbody>
						{filteredUsers.map(user => {
							const access = personalLinks.data?.[user.id];
							return (
								<tr key={user.id}>
									<td className={styles.avatarCol}>
										<div className={styles.avatar}>
											{user.image && (
												<Image src={user.image} alt="" className={styles.userImage} fill sizes="40px" unoptimized />
											)}
										</div>
									</td>
									<td className={styles.nameCol}>
										<div className={styles.displayName}>{user.displayName || user.name || "(no name in Slack)"}</div>
										{user.displayName && user.name && <div className={styles.realName}>{user.name}</div>}
										{access && <NameIssues issues={access.nameIssues} />}
									</td>
									{isAdmin && (
										<td className={styles.gateCol}>
											{access && (
												<GeneralAccessControls
													userId={user.id}
													status={access.status}
													isAdmin={user.isAdmin}
													canApprove={access.nameIssues.length === 0}
													blockedBy={
														access.nameIssues.length === 0
															? null
															: access.nameIssues.includes("unverified")
																? "unverified"
																: "wrong_names"
													}
													gateUrlConfigured={accessConfig.data?.gateUrlConfigured ?? false}
													onChanged={() => personalLinks.refetch()}
												/>
											)}
										</td>
									)}
									{isAdmin && (
										<td className={styles.teamsCol}>
											<div className={styles.teamChips}>
												{user.teams === "admin" ? (
													<span className={styles.teamChip}>Admin</span>
												) : (
													user.teams.map(team => (
														<span key={team} className={styles.teamChip}>
															<TeamAvatar teamNumber={team} size="1.1em" />
															{team}
														</span>
													))
												)}
											</div>
										</td>
									)}
									<td className={styles.createdCol}>{dateToDateString(user.created)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
