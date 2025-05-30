/**
 * Backend for the reservation system.
 *
 * This file contains the backend logic for managing reservations, blackouts, site events, and keys.
 * It handles write permissions for keys.
 * It also handles data storage and retrieval using JSON files.
 * All APIs here expect safe data, so they don't do any validation.
 */

console.log(`🟢 Backend module loading - PID: ${process.pid}`);

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { exit } from "./util/exit";
import { Lock } from "./util/Lock";
import {
	tellClientsAboutBlackoutChange,
	tellClientsAboutReservationChange,
	tellClientsAboutSiteEvent,
} from "./websocket";
import type { JsonData } from "./util/JsonData";
import type {
	AddReservationArgs,
	Blackout,
	EventDate,
	RemoveReservationArgs,
	Reservation,
	SiteEvent,
	Team,
	TeamFull,
	TimeSlot,
	UserId,
} from "~/types";
import type { Session } from "next-auth";
import crypto from "node:crypto";

const FirstUserIsAdmin = true; // If true, the first user created will be an admin
const ContinueOnError = true; // If true, the server will continue running even if an error occurs
const AdvancedReservationDays = 7; // Number of days in the future that reservations can be made
const DisableWrites = false; // If true, the server will not write to the database

// Add unique module instance ID for tracking reinitialization
const MODULE_INSTANCE_ID = crypto.randomUUID().substring(0, 8);
console.log(`🔥 Backend module instance ${MODULE_INSTANCE_ID} loading - PID: ${process.pid}`);

console.log(
	`📦 [${MODULE_INSTANCE_ID}] Using globals - reservations: ${reservations.length}, initialized: ${globalThis.__backendInitialized} - PID: ${process.pid}`,
);

type LogCommon = {
	timestamp: Date;
	ip: string;
	userAgent: string;
	userId: UserId;
};

type LogReservationEntry = LogCommon & {
	type: "created" | "updated" | "deleted";
	date: EventDate;
	slot: TimeSlot;
	team: TeamFull;
	notes?: string;
};

type LogBlackoutEntry = LogCommon & {
	type: "blackoutAdd" | "blackoutRemove";
	date: EventDate;
	slot: TimeSlot;
	reason?: string;
};

type LogSiteEventEntry = LogCommon & {
	type: "siteEventAdd" | "siteEventRemove";
	date: EventDate;
	notes?: string;
};

type LogUserEntry = LogCommon & {
	type: "userAdd" | "userUpdate";
	userId: UserId;
	name: string;
	teams: Team[] | "admin";
};

type LogEntry = LogReservationEntry | LogBlackoutEntry | LogSiteEventEntry | LogUserEntry;

type UserEntry = {
	id: UserId;
	name: string;
	created: Date | string;
	updated: Date | string;
	disabled?: boolean;
	teams: Team[] | "admin";
	email: string;
	image: string;
};

const reservations: Reservation[] = [];
const blackouts: Blackout[] = [];
const siteEvents: SiteEvent[] = [];
const users: UserEntry[] = [];
const houseTeams: Team[] = [];

export class PermissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PermissionError";
	}
}

function getReservation(id: string): Reservation | undefined {
	return reservations.find(reservation => reservation.id === id && !reservation.abandoned);
}

async function log(entry: LogEntry) {
	return appendLog(entry).catch(err => {
		console.error("Error logging entry:", err);
	});
}

export class Context {
	private user: UserEntry;

	constructor(
		private session: Session,
		private userAgent: string,
		private ip: string,
	) {
		this.user = this.getUser();
	}

	async addReservation(reservation: AddReservationArgs) {
		console.log(`🟢 [${MODULE_INSTANCE_ID}] addReservation START - PID: ${process.pid}`);
		this.restrictToTeam(reservation.team, "Only team members can add reservations");
		this.restrictTimeframe(reservation.date);

		const existingReservation = reservations.find(
			r => r.date === reservation.date && r.slot === reservation.slot && r.team === reservation.team && !r.abandoned,
		);
		if (existingReservation) {
			throw new Error("Reservation already exists for this date and slot");
		}

		console.log(`🟡 [${MODULE_INSTANCE_ID}] About to acquire lock - PID: ${process.pid}`);
		const release = await changeLock.acquire();
		console.log(`🟡 [${MODULE_INSTANCE_ID}] Lock acquired - PID: ${process.pid}`);
		const ctx = this.getContext();
		const jobs: Promise<unknown>[] = [];

		const res: Reservation = {
			...reservation,
			id: crypto.randomUUID(),
			userId: this.user.id,
			created: ctx.timestamp,
		};

		console.log(
			`🟡 [${MODULE_INSTANCE_ID}] Adding to reservations array (current size: ${reservations.length}) - PID: ${process.pid}`,
		);
		reservations.push(res);

		jobs.push(
			log({
				...ctx,
				type: "created",
				date: reservation.date,
				slot: reservation.slot,
				team: reservation.team,
				notes: reservation.notes,
			}),
		);

		jobs.push(tellClientsAboutReservationChange(res));

		jobs.push(writeJsonFile(RESERVATIONS_FILE, reservations));

		console.log(`🟡 [${MODULE_INSTANCE_ID}] About to start Promise.all with ${jobs.length} jobs - PID: ${process.pid}`);
		const done = Promise.all(jobs);

		console.log(`🟡 [${MODULE_INSTANCE_ID}] About to await Promise.all - PID: ${process.pid}`);
		await (ContinueOnError ? done.finally(release) : done.then(release));
		console.log(`🟢 [${MODULE_INSTANCE_ID}] addReservation END - PID: ${process.pid}`);

		return res;
	}

	async removeReservation({ id, reason }: RemoveReservationArgs) {
		const reservation = getReservation(id);

		if (!reservation) {
			throw new Error("Reservation not found");
		}

		this.restrictToTeam(reservation.team, "Only team members can remove reservations");
		this.restrictTimeframe(reservation.date);

		const release = await changeLock.acquire();
		const ctx = this.getContext();
		const jobs: Promise<unknown>[] = [];

		jobs.push(
			log({
				...ctx,
				type: "deleted",
				date: reservation.date,
				slot: reservation.slot,
				team: reservation.team,
				notes: reason,
			}),
		);

		// Mark as abandoned instead of deleting
		reservation.abandoned = ctx.timestamp;
		// Update the user ID to the current user
		reservation.userId = this.user.id;
		// Store the reason for the removal
		if (reason) reservation.notes = reason;

		jobs.push(tellClientsAboutReservationChange(reservation));

		jobs.push(writeJsonFile(RESERVATIONS_FILE, reservations));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));

		return reservation;
	}

	async addBlackout(blackout: Omit<Blackout, "created" | "userId" | "deleted">) {
		this.restrictToAdmin("Only admins can add blackouts");

		const release = await changeLock.acquire();
		const ctx = this.getContext();
		const jobs: Promise<unknown>[] = [];

		const newBlackout: Blackout = {
			...blackout,
			created: ctx.timestamp,
			userId: this.user.id, // Update the user ID to the current user
		};

		blackouts.push(newBlackout);

		jobs.push(
			log({
				...ctx,
				type: "blackoutAdd",
				date: blackout.date,
				slot: blackout.slot,
				reason: blackout.reason,
			}),
		);
		jobs.push(tellClientsAboutBlackoutChange(newBlackout));

		jobs.push(writeJsonFile(BLACKOUTS_FILE, blackouts));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));
	}

	async removeBlackout({ date, slot }: Omit<Blackout, "created" | "userId" | "deleted">) {
		this.restrictToAdmin("Only admins can remove blackouts");

		const blackout = blackouts.find(b => b.date === date && b.slot === slot);
		if (!blackout) {
			throw new Error("Blackout not found");
		}

		const jobs: Promise<unknown>[] = [];
		const ctx = this.getContext();
		const release = await changeLock.acquire();

		blackout.deleted = ctx.timestamp; // Mark as deleted
		blackout.userId = this.user.id; // Update the user ID to the current user

		jobs.push(
			log({
				...ctx,
				type: "blackoutRemove",
				date: blackout.date,
				slot: blackout.slot,
			}),
		);

		jobs.push(tellClientsAboutBlackoutChange(blackout));

		jobs.push(writeJsonFile(BLACKOUTS_FILE, blackouts));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));
	}

	async addSiteEvent(event: Pick<SiteEvent, "date" | "notes">) {
		this.restrictToAdmin("Only admins can add site events");

		const release = await changeLock.acquire();
		const ctx = this.getContext();
		const jobs: Promise<unknown>[] = [];

		const newEvent: SiteEvent = {
			...event,
			created: ctx.timestamp,
			userId: this.user.id, // Update the user ID to the current user
		};

		siteEvents.push(newEvent);

		jobs.push(
			log({
				...ctx,
				type: "siteEventAdd",
				...event,
			}),
		);

		jobs.push(tellClientsAboutSiteEvent(newEvent));

		jobs.push(writeJsonFile(SITE_EVENTS_FILE, siteEvents));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));
	}

	async removeSiteEvent({ date }: Omit<SiteEvent, "created" | "userId" | "deleted">) {
		this.restrictToAdmin("Only admins can remove site events");

		const event = siteEvents.find(e => e.date === date && !e.deleted);

		if (!event) throw new Error("Site event not found");

		const release = await changeLock.acquire();
		const ctx = this.getContext();
		const jobs: Promise<unknown>[] = [];

		event.deleted = ctx.timestamp;

		jobs.push(
			log({
				...ctx,
				type: "siteEventRemove",
				date: event.date,
			}),
		);

		jobs.push(tellClientsAboutSiteEvent(event));

		jobs.push(writeJsonFile(SITE_EVENTS_FILE, siteEvents));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));
	}

	private getUser(): UserEntry {
		if (!this.session?.user) {
			throw new PermissionError("Not authenticated");
		}

		const user = users.find(u => u.id === this.session.user.id);
		if (!user) {
			// Create new user entry on first login
			const newUser: UserEntry = {
				id: this.session.user.id,
				name: this.session.user.name ?? this.session.user.email ?? "Unknown",
				created: new Date(),
				updated: new Date(),
				teams: FirstUserIsAdmin && !users.length ? "admin" : [],
				email: this.session.user.email ?? "",
				image: this.session.user.image ?? "",
			};
			users.push(newUser);

			// Save the updated users array
			void writeJsonFile(USERS_FILE, users).catch(err => {
				console.error("Error saving users:", err);
			});

			return newUser;
		}

		if (user.disabled) {
			throw new PermissionError("User disabled");
		}

		return user;
	}

	getTeams() {
		return this.user.teams;
	}

	getName() {
		return this.user.name;
	}

	private getEditPermissions() {
		return this.user.teams;
	}

	private isAdmin() {
		return this.getEditPermissions() === "admin";
	}

	private restrictToAdmin(message: string) {
		if (this.isAdmin()) return;
		throw new PermissionError(message);
	}

	private restrictToTeam(team: Team | TeamFull, message: string) {
		if (typeof team === "string") team = Number.parseInt(team, 10);

		const permissions = this.getEditPermissions();
		if (permissions === "admin") return;
		if (permissions.includes(team)) return;
		throw new PermissionError(message);
	}

	private restrictTimeframe(date: EventDate) {
		if (this.isAdmin()) return; // Admins can reserve any date

		const thisMorning = new Date();
		thisMorning.setHours(0, 0, 0, 0); // Set time to midnight
		const reservationDate = new Date(date);

		if (reservationDate < thisMorning) throw new PermissionError("Cannot reserve a date in the past");

		if (reservationDate > new Date(new Date().getTime() + 1000 * 60 * 60 * 24 * AdvancedReservationDays))
			throw new PermissionError(`Cannot reserve a date more than ${AdvancedReservationDays} days in advance`);
	}

	private getContext() {
		return {
			timestamp: new Date(),
			userId: this.user.id,
			userAgent: this.userAgent,
			ip: this.ip,
		};
	}

	async listReservations(date: EventDate): Promise<Reservation[]> {
		// First check if user is logged in
		if (!this.user) throw new PermissionError("Not authenticated");

		// Return only non-abandoned reservations for the given date from in-memory array
		const result = reservations.filter(reservation => reservation.date === date && !reservation.abandoned);
		console.log(
			`📋 [${MODULE_INSTANCE_ID}] listReservations(${date}) returning ${result.length} items (total in memory: ${reservations.length}) - PID: ${process.pid}`,
		);
		return result;
	}
}

// export { reservations, blackouts, siteEvents };

////// Storage Management //////

// File paths for data storage
const DATA_DIR = resolve("./data");
const YEAR = new Date().getFullYear().toString();
// Keys & Users persist across years, so we don't include the year in the path
const KEYS_FILE = join(DATA_DIR, "keys.json");
const USERS_FILE = join(DATA_DIR, "users.json");
// Reservations, blackouts, and site events are year-specific
const RESERVATIONS_FILE = join(DATA_DIR, YEAR, "reservations.json");
const BLACKOUTS_FILE = join(DATA_DIR, YEAR, "blackouts.json");
const SITE_EVENTS_FILE = join(DATA_DIR, YEAR, "events.json");
const HOUSE_TEAMS_FILE = join(DATA_DIR, YEAR, "teams.json");
// Logs file is also year-specific
const LOGS_FILE = join(DATA_DIR, YEAR, "logs.txt");

const changeLock = new Lock();
const initialized = changeLock.acquire();

// Make sure we're never running across a year's boundary
setInterval(async () => {
	if (new Date().getFullYear().toString() === YEAR) return;

	console.warn("Year has changed. Shutting down to ensure data integrity.");

	// Wait for any ongoing changes to finish
	await changeLock.acquire();

	process.exit(0);
	// Systemd should restart the process automatically
}, 1000).unref(); // Check every second and unref to avoid keeping Node.js alive

// Read JSON data from a file
async function readJsonFile(filePath: string) {
	const data = await readFile(filePath, "utf-8");
	return JSON.parse(data);
}

// Write JSON data to a file
async function writeJsonFile(filePath: string, data: JsonData) {
	if (DisableWrites) return;
	try {
		await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
	} catch (err) {
		console.error("Error writing to file:", filePath, err);
	}
}

// Append a log entry to the logs file
async function appendLog(logEntry: JsonData) {
	if (DisableWrites) return;
	try {
		const logLine = JSON.stringify(logEntry);
		await appendFile(LOGS_FILE, `${logLine}\n`, "utf-8");
	} catch (err) {
		console.error("Error appending to logs file:", err);
	}
}

function isHouseTeam(team: Team) {
	return houseTeams.includes(team);
}

function getFilePath(array: unknown[]) {
	if (array === reservations) return RESERVATIONS_FILE;
	if (array === blackouts) return BLACKOUTS_FILE;
	if (array === siteEvents) return SITE_EVENTS_FILE;
	if (array === users) return USERS_FILE;
	if (array === houseTeams) return HOUSE_TEAMS_FILE;
	throw new Error("Unknown array type");
}

async function notifyClientsAboutChange(array: unknown[]) {
	if (array === reservations) return Promise.all(reservations.map(tellClientsAboutReservationChange));
	if (array === blackouts) return Promise.all(blackouts.map(tellClientsAboutBlackoutChange));
	if (array === siteEvents) return Promise.all(siteEvents.map(tellClientsAboutSiteEvent));
}

async function initializePart(array: unknown[]) {
	const filePath = getFilePath(array);
	const arrayName = getArrayName(array);

	console.log(`🔧 [${MODULE_INSTANCE_ID}] Initializing ${arrayName} from ${filePath} - PID: ${process.pid}`);

	try {
		const data = await readJsonFile(filePath);

		if (!Array.isArray(data)) throw new Error(`Invalid data in ${filePath}`);

		if (array.length > 0) {
			console.log(
				`🔴 [${MODULE_INSTANCE_ID}] REINITIALIZING ${arrayName}: ${array.length} existing items will be replaced - PID: ${process.pid}`,
			);
			array.length = 0;
		}

		array.push(
			...data.filter(item => {
				// Filter out expired keys
				if (array === users) {
					if (typeof item !== "object" || item === null) return false;
					if (typeof item.created !== "string") return false;
					if (item.disabled) {
						if (new Date(item.created) < new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2)) return false; // 2 year expiration
					} else if (new Date(item.created) < new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 1.5)) {
						item.disabled = true;
					}
				}

				return true;
			}),
		);

		console.log(`✅ [${MODULE_INSTANCE_ID}] ${arrayName} initialized with ${array.length} items - PID: ${process.pid}`);
		notifyClientsAboutChange(array);
	} catch (err) {
		if (!(err instanceof Error)) throw err;
		if (!("code" in err)) throw err;
		if (err.code !== "ENOENT") throw err;

		// File doesn't exist, so we create it
		await mkdir(resolve(filePath, ".."), { recursive: true });
		// All of our data files are JSON arrays, so we can initialize them as empty arrays
		await writeFile(filePath, "[]", "utf-8");
		console.log(`📁 [${MODULE_INSTANCE_ID}] Created empty ${arrayName} file - PID: ${process.pid}`);
	}
}

function getArrayName(array: unknown[]): string {
	if (array === reservations) return "reservations";
	if (array === blackouts) return "blackouts";
	if (array === siteEvents) return "siteEvents";
	if (array === users) return "users";
	if (array === houseTeams) return "houseTeams";
	return "unknown";
}

(async () => {
	const done = await initialized; // Wait for the lock to be acquired

	console.log(`🚀 [${MODULE_INSTANCE_ID}] Starting data initialization - PID: ${process.pid}`);

	const jobs: Promise<unknown>[] = [];

	jobs.push(initializePart(reservations));
	jobs.push(initializePart(blackouts));
	jobs.push(initializePart(siteEvents));
	jobs.push(initializePart(users));
	jobs.push(initializePart(houseTeams));

	await Promise.all(jobs);

	console.log(`🎉 [${MODULE_INSTANCE_ID}] Data initialization complete - PID: ${process.pid}`);
	done();
})().catch(err => {
	console.error(`❌ [${MODULE_INSTANCE_ID}] Error initializing data - PID: ${process.pid}:`, err);
	exit(1); // Exit the process on initialization error
});

process.on("exit", code => {
	console.log(`🔴 Process ${process.pid} exiting with code: ${code}`);
});

process.on("beforeExit", code => {
	console.log(`🔴 Process ${process.pid} before exit with code: ${code}`);
});

process.on("SIGTERM", () => {
	console.log(`🔴 Process ${process.pid} received SIGTERM`);
});

process.on("SIGINT", () => {
	console.log(`🔴 Process ${process.pid} received SIGINT`);
});

process.on("uncaughtException", err => {
	console.error(`🔴 Uncaught Exception in PID ${process.pid}:`, err);
});

process.on("unhandledRejection", (reason, promise) => {
	console.error(`🔴 Unhandled Rejection in PID ${process.pid}:`, reason);
});

let interval = 3000;
(function uptimeLoop() {
	console.log(`Process ${process.pid} has been running for ${process.uptime()} seconds`);
	interval *= 1.1;
	setTimeout(uptimeLoop, interval);
})();
