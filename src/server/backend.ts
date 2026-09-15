/**
 * Backend for the reservation system.
 *
 * This file contains the backend logic for managing reservations, blackouts, site events, and keys.
 * It handles write permissions for keys.
 * It also handles data storage and retrieval using JSON files.
 * All APIs here expect safe data, so they don't do any validation.
 */

import crypto from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Session } from "next-auth";
import { env } from "~/env";
import type {
	AddReservationArgs,
	Blackout,
	EventDate,
	Holiday,
	RemoveReservationArgs,
	Reservation,
	SiteEvent,
	Team,
	TeamFull,
	TimeSlot,
	UserEntry,
	UserId,
} from "~/types";
import { type AccessCheckResult, evaluateUserAccess } from "./access";
import { notifyTeamOfReservation, selectReservationDmRecipients, sendAccessTokenWelcome } from "./notifications";
import { exit } from "./util/exit";
import type { JsonData } from "./util/JsonData";
import { Lock } from "./util/Lock";
import { parseSlackName, pickNameForValidation } from "./util/slackName";
import {
	tellClientsAboutBlackoutChange,
	tellClientsAboutReservationChange,
	tellClientsAboutSiteEvent,
} from "./websocket";

const FirstUserIsAdmin = true; // If true, the first user created will be an admin
const ContinueOnError = true; // If true, the server will continue running even if an error occurs
const AdvancedReservationDays = 7; // Number of days in the future that reservations can be made
const DisableWrites = false; // If true, the server will not write to the database

// Add unique module instance ID for tracking reinitialization
const MODULE_INSTANCE_ID = crypto.randomUUID().substring(0, 8);

// Global storage for HMR persistence
declare global {
	var __reservations: Reservation[] | undefined;
	var __blackouts: Blackout[] | undefined;
	var __siteEvents: SiteEvent[] | undefined;
	var __holidays: Holiday[] | undefined;
	var __users: UserEntry[] | undefined;
	var __houseTeams: Team[] | undefined;
	var __slackMappings: { slackId: string; userId: UserId }[] | undefined;
	var __usersByAccessToken: Map<string, UserEntry> | undefined;
	var __backendInitialized: boolean | undefined;
	var __changeLock: Lock | undefined;
}

// Initialize or reuse global arrays
globalThis.__reservations ||= [];
globalThis.__blackouts ||= [];
globalThis.__siteEvents ||= [];
globalThis.__holidays ||= [];
globalThis.__users ||= [];
globalThis.__houseTeams ||= [];
globalThis.__slackMappings ||= [];
globalThis.__usersByAccessToken ||= new Map();

const reservations = globalThis.__reservations;
const blackouts = globalThis.__blackouts;
const siteEvents = globalThis.__siteEvents;
const holidays = globalThis.__holidays;
const users = globalThis.__users;
const houseTeams = globalThis.__houseTeams;
const slackMappings = globalThis.__slackMappings;
const usersByAccessToken = globalThis.__usersByAccessToken;

function newAccessToken(): string {
	// 24 random bytes ⇒ 32 url-safe characters, ~192 bits of entropy.
	return crypto.randomBytes(24).toString("base64url");
}

/**
 * Lazily issue a per-user access token if the user doesn't have one yet,
 * and ensure it's indexed in usersByAccessToken. Safe to call on every
 * login — no-ops if already issued.
 *
 * Returns whether the token was issued on THIS call, so the caller can
 * trigger one-time follow-up (e.g. DMing the user their gate URL).
 */
async function ensureAccessToken(user: UserEntry): Promise<{ tokenJustIssued: boolean }> {
	if (user.accessToken) {
		if (!usersByAccessToken.has(user.accessToken)) usersByAccessToken.set(user.accessToken, user);
		return { tokenJustIssued: false };
	}
	const release = await changeLock.acquire();
	// Re-check under the lock to avoid double-issuance on concurrent logins.
	if (user.accessToken) {
		release();
		return { tokenJustIssued: false };
	}
	user.accessToken = newAccessToken();
	usersByAccessToken.set(user.accessToken, user);
	try {
		await writeJsonFile(USERS_FILE, users);
	} catch (err) {
		console.error("Error persisting user access token:", err);
	} finally {
		release();
	}
	return { tokenJustIssued: true };
}

/**
 * Fire-and-forget welcome DM (logs but doesn't throw). Pulled out so the
 * login flow stays linear.
 *
 * Skipped if the user has no team membership — they'd just receive a link
 * that doesn't open the gate, which is worse than no DM at all. Once they
 * fix their Slack name (or an admin assigns teams), the next login issues
 * a new token attempt? No — token is already issued; the *welcome* DM is
 * one-shot. We accept that someone who logs in with a bad name then fixes
 * it won't get a follow-up welcome DM; the gate URL itself just starts
 * working. They can grab it from the admin UI in a follow-up.
 */
function fireWelcomeDm(user: UserEntry, slackId: string): void {
	if (user.teams !== "admin" && user.teams.length === 0) {
		console.warn(
			`Skipping welcome DM for user ${user.id} (slack ${slackId}): no teams assigned (likely invalid Slack name format).`,
		);
		return;
	}
	void sendAccessTokenWelcome(user, slackId).then(outcome => {
		if (!outcome.sent) {
			console.warn(
				`Welcome DM not sent to user ${user.id} (slack ${slackId}): ${outcome.reason}${
					outcome.error ? ` — ${outcome.error}` : ""
				}`,
			);
		}
	});
}

/**
 * Update a stored user record to match the fresh values from the current
 * Slack session. Specifically:
 *   - Re-sync `name` / `displayName` if Slack reports new values.
 *   - If the display name parses as "First Last (1234[, 5678…])", treat
 *     it as authoritative and update `teams` to match (admins are skipped).
 * Persists the users file if anything changed. Logs a warning if the name
 * doesn't parse; the actual login block when STRICT_SLACK_NAMES is on
 * happens in the NextAuth signIn callback.
 *
 * Returns `teamsWentFromZero=true` when this sync moved the user from
 * "no team membership" to "at least one team" — the caller uses that to
 * fire the welcome DM that was skipped on a previous bad-name login.
 */
async function syncUserFromSession(
	user: UserEntry,
	sessionName: string | undefined,
	sessionDisplayName: string | undefined,
): Promise<{ teamsWentFromZero: boolean }> {
	let dirty = false;
	let teamsWentFromZero = false;

	if (sessionName && sessionName !== user.name) {
		user.name = sessionName;
		dirty = true;
	}
	if (sessionDisplayName !== undefined && sessionDisplayName !== user.displayName) {
		user.displayName = sessionDisplayName;
		dirty = true;
	}

	const candidate = pickNameForValidation({ name: user.name, displayName: user.displayName });
	const parsed = parseSlackName(candidate);

	if (parsed && user.teams !== "admin") {
		const wanted = [...parsed.teams].sort((a, b) => a - b);
		const current = [...(user.teams as Team[])].sort((a, b) => a - b);
		if (wanted.length !== current.length || wanted.some((t, i) => t !== current[i])) {
			if (current.length === 0 && wanted.length > 0) teamsWentFromZero = true;
			user.teams = wanted;
			dirty = true;
		}
	} else if (!parsed) {
		console.warn(`User ${user.id} has an invalid Slack name format: ${JSON.stringify(candidate)}`);
	}

	if (!dirty) return { teamsWentFromZero };

	user.updated = new Date();
	const release = await changeLock.acquire();
	try {
		await writeJsonFile(USERS_FILE, users);
	} catch (err) {
		console.error("Error persisting user sync:", err);
	} finally {
		release();
	}
	return { teamsWentFromZero };
}

/**
 * Fire-and-forget DMs to every team-member of the reservation (excluding
 * the creator). Best-effort — logs failures but never blocks the caller.
 */
function fireReservationDmsForTeam(reservation: Reservation, excludeUserId: UserId): void {
	const { recipients, skipReason } = selectReservationDmRecipients(users, slackMappings, reservation, excludeUserId);
	if (skipReason === "non_numeric_team") {
		console.warn(
			`Reservation ${reservation.id} has non-numeric team ${JSON.stringify(reservation.team)}; skipping DMs.`,
		);
		return;
	}
	if (recipients.length === 0) return;

	void notifyTeamOfReservation(reservation, recipients)
		.then(outcomes => {
			const failed = outcomes.filter(o => !o.sent);
			if (failed.length > 0) {
				console.warn(
					`Reservation ${reservation.id}: ${failed.length}/${outcomes.length} DM(s) failed:`,
					failed.map(f => `${f.userId}/${f.slackUserId}: ${f.error ?? f.reason}`),
				);
			}
		})
		.catch(err => console.error(`Reservation ${reservation.id} DM batch failed:`, err));
}

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
	private user: Promise<UserEntry>;

	constructor(
		private session: Session,
		private userAgent: string,
		private ip: string,
	) {
		this.user = this.getUser();
	}

	async addReservation(reservation: AddReservationArgs) {
		console.log(`🟢 [${MODULE_INSTANCE_ID}] addReservation START - PID: ${process.pid}`);
		await this.restrictToTeam(reservation.team, "Only team members can add reservations");
		await this.restrictTimeframe(reservation.date);

		const existingReservation = reservations.find(
			r => r.date === reservation.date && r.slot === reservation.slot && r.team === reservation.team && !r.abandoned,
		);
		if (existingReservation) {
			throw new Error("Reservation already exists for this date and slot");
		}

		console.log(`🟡 [${MODULE_INSTANCE_ID}] About to acquire lock - PID: ${process.pid}`);
		const release = await changeLock.acquire();
		console.log(`🟡 [${MODULE_INSTANCE_ID}] Lock acquired - PID: ${process.pid}`);
		const ctx = await this.getContext();
		const jobs: Promise<unknown>[] = [];

		const res: Reservation = {
			...reservation,
			id: crypto.randomUUID(),
			userId: (await this.user).id,
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

		// Fire-and-forget DMs to other team members so they get a reminder
		// + their personal gate link. Excludes the creator (they already know).
		const creatorId = (await this.user).id;
		fireReservationDmsForTeam(res, creatorId);

		return res;
	}

	async removeReservation({ id, reason }: RemoveReservationArgs) {
		const reservation = getReservation(id);

		if (!reservation) {
			throw new Error("Reservation not found");
		}

		await this.restrictToTeam(reservation.team, "Only team members can remove reservations");
		await this.restrictTimeframe(reservation.date);

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
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
		reservation.userId = (await this.user).id;
		// Store the reason for the removal
		if (reason) reservation.notes = reason;

		jobs.push(tellClientsAboutReservationChange(reservation));

		jobs.push(writeJsonFile(RESERVATIONS_FILE, reservations));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));

		return reservation;
	}

	async addBlackout(blackout: Omit<Blackout, "created" | "userId" | "deleted">) {
		await this.restrictToAdmin("Only admins can add blackouts");

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
		const jobs: Promise<unknown>[] = [];

		const newBlackout: Blackout = {
			...blackout,
			created: ctx.timestamp,
			userId: (await this.user).id, // Update the user ID to the current user
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
		await this.restrictToAdmin("Only admins can remove blackouts");

		const blackout = blackouts.find(b => b.date === date && b.slot === slot);
		if (!blackout) {
			throw new Error("Blackout not found");
		}

		const jobs: Promise<unknown>[] = [];
		const ctx = await this.getContext();
		const release = await changeLock.acquire();

		blackout.deleted = ctx.timestamp; // Mark as deleted
		blackout.userId = (await this.user).id; // Update the user ID to the current user

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
		await this.restrictToAdmin("Only admins can add site events");

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
		const jobs: Promise<unknown>[] = [];

		const newEvent: SiteEvent = {
			...event,
			created: ctx.timestamp,
			userId: (await this.user).id, // Update the user ID to the current user
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
		await this.restrictToAdmin("Only admins can remove site events");

		const event = siteEvents.find(e => e.date === date && !e.deleted);

		if (!event) throw new Error("Site event not found");

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
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

	async addHoliday(holiday: Omit<Holiday, "id">) {
		await this.restrictToAdmin("Only admins can add holidays");

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
		const jobs: Promise<unknown>[] = [];

		const newHoliday: Holiday = {
			...holiday,
			id: crypto.randomUUID(),
			// Only set created and userId if not already provided (for system holidays)
			created: holiday.created ?? ctx.timestamp,
			userId: holiday.userId ?? (await this.user).id,
		};

		holidays.push(newHoliday);

		jobs.push(writeJsonFile(HOLIDAYS_FILE, holidays));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));

		return newHoliday;
	}

	async removeHoliday({ id }: { id: string }) {
		await this.restrictToAdmin("Only admins can remove holidays");

		const holiday = holidays.find(h => h.id === id && !h.deleted);
		if (!holiday) {
			throw new Error("Holiday not found");
		}

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
		const jobs: Promise<unknown>[] = [];

		holiday.deleted = ctx.timestamp;

		jobs.push(writeJsonFile(HOLIDAYS_FILE, holidays));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));
	}

	async getHolidays(): Promise<Holiday[]> {
		await initialized();
		return holidays.filter(h => !h.deleted);
	}

	private async getUser(): Promise<UserEntry> {
		if (!this.session?.user) {
			throw new PermissionError("Not authenticated");
		}

		await initialized();

		const slackId = this.session.user.id;
		const email = this.session.user.email ?? "";

		const sessionName = this.session.user.name ?? undefined;
		const sessionDisplayName = this.session.user.displayName;

		// First check if we have a direct Slack ID mapping
		const existingMapping = slackMappings.find(m => m.slackId === slackId);
		if (existingMapping) {
			const user = users.find(u => u.id === existingMapping.userId);
			if (!user) {
				throw new Error("User mapping exists but user not found");
			}
			if (user.disabled) {
				throw new PermissionError("User disabled");
			}
			const { teamsWentFromZero } = await syncUserFromSession(user, sessionName, sessionDisplayName);
			const { tokenJustIssued } = await ensureAccessToken(user);
			if (tokenJustIssued || teamsWentFromZero) fireWelcomeDm(user, slackId);
			return user;
		}

		// If no Slack ID mapping, check if we have a user with this email
		if (email) {
			const existingUser = users.find(u => u.email === email);
			if (existingUser) {
				const release = await changeLock.acquire();

				// Found existing user by email, create a new Slack mapping
				slackMappings.push({
					slackId,
					userId: existingUser.id,
				});

				// Save the new mapping
				void writeJsonFile(SLACK_MAPPINGS_FILE, slackMappings)
					.catch(err => {
						console.error("Error saving Slack mapping:", err);
					})
					.finally(release);

				const { teamsWentFromZero } = await syncUserFromSession(existingUser, sessionName, sessionDisplayName);
				const { tokenJustIssued } = await ensureAccessToken(existingUser);
				if (tokenJustIssued || teamsWentFromZero) fireWelcomeDm(existingUser, slackId);
				return existingUser;
			}
		}

		// No existing user found, create new user entry
		const newUserId = crypto.randomUUID();
		const nameForUser = this.session.user.name ?? email ?? "Unknown";
		const parsedSlackName = parseSlackName(
			pickNameForValidation({ name: nameForUser, displayName: sessionDisplayName }),
		);
		const sortedTeams = parsedSlackName ? [...parsedSlackName.teams].sort((a, b) => a - b) : [];
		const newUser: UserEntry = {
			id: newUserId,
			name: nameForUser,
			displayName: sessionDisplayName,
			created: new Date(),
			updated: new Date(),
			teams: FirstUserIsAdmin && !users.length ? "admin" : sortedTeams,
			email,
			image: this.session.user.image ?? "",
			accessToken: newAccessToken(),
		};
		if (newUser.accessToken) usersByAccessToken.set(newUser.accessToken, newUser);

		const release = await changeLock.acquire();

		users.push(newUser);

		// Add Slack mapping
		slackMappings.push({
			slackId,
			userId: newUserId,
		});

		// Save both the updated users array and slack mappings
		void Promise.all(
			[users, slackMappings].map(a =>
				writeJsonFile(getFilePath(a), a).catch(err => console.error("Error saving user data:", err)),
			),
		).then(release);

		fireWelcomeDm(newUser, slackId);

		return newUser;
	}

	async getTeams() {
		return (await this.user).teams;
	}

	async getName() {
		return (await this.user).name;
	}

	private async getEditPermissions() {
		return (await this.user).teams;
	}

	async getUsers() {
		await initialized();

		let u = users;

		if (!this.isAdmin()) {
			u = u.filter(user => !user.disabled);

			// Remove email from the user object
			u = u.map(user => ({
				id: user.id,
				name: user.name,
				displayName: user.displayName,
				image: user.image,
				created: user.created,
				updated: user.updated,
				teams: user.teams,
				email: "",
			}));
		}

		return u;
	}

	private async isAdmin() {
		return (await this.getEditPermissions()) === "admin";
	}

	private async restrictToAdmin(message: string) {
		if (await this.isAdmin()) return;
		throw new PermissionError(message);
	}

	/** Throws PermissionError if the current user isn't an admin. */
	async assertAdmin(message = "Admin access required"): Promise<void> {
		await this.restrictToAdmin(message);
	}

	/** Slack user ID (e.g. "U01ABCDEF") of the current session, for DM targeting. */
	getSlackUserId(): string {
		return this.session.user.id;
	}

	/**
	 * Admin-only: list users whose Slack display name does NOT match the
	 * expected "First Last (1234)" convention, alongside the Slack IDs that
	 * map to them so callers can DM the user. Disabled users are excluded.
	 */
	async listUsersWithInvalidSlackName(): Promise<Array<{ user: UserEntry; slackIds: string[] }>> {
		await this.assertAdmin("Only admins can audit user names");
		await initialized();

		const out: Array<{ user: UserEntry; slackIds: string[] }> = [];
		for (const user of users) {
			if (user.disabled) continue;
			const candidate = pickNameForValidation(user);
			if (parseSlackName(candidate) !== null) continue;
			const slackIds = slackMappings.filter(m => m.userId === user.id).map(m => m.slackId);
			out.push({ user, slackIds });
		}
		return out;
	}

	private async restrictToTeam(team: Team | TeamFull, message: string) {
		if (typeof team === "string") team = Number.parseInt(team, 10);

		const permissions = await this.getEditPermissions();
		if (permissions === "admin") return;
		if (permissions.includes(team)) return;
		throw new PermissionError(message);
	}

	private async restrictTimeframe(date: EventDate) {
		if (await this.isAdmin()) return; // Admins can reserve any date

		const thisMorning = new Date();
		thisMorning.setHours(0, 0, 0, 0); // Set time to midnight
		const reservationDate = new Date(date);

		if (reservationDate < thisMorning) throw new PermissionError("Cannot reserve a date in the past");

		if (reservationDate > new Date(Date.now() + 1000 * 60 * 60 * 24 * AdvancedReservationDays))
			throw new PermissionError(`Cannot reserve a date more than ${AdvancedReservationDays} days in advance`);
	}

	private async getContext() {
		return {
			timestamp: new Date(),
			userId: (await this.user).id,
			userAgent: this.userAgent,
			ip: this.ip,
		};
	}

	async listReservations(date: EventDate): Promise<Reservation[]> {
		// First check if user is logged in
		if (!(await this.user)) throw new PermissionError("Not authenticated");

		// Return only non-abandoned reservations for the given date from in-memory array
		return reservations.filter(reservation => reservation.date === date && !reservation.abandoned);
	}
}

// export { reservations, blackouts, siteEvents };

////// Storage Management //////

// File paths for data storage
const DATA_DIR = resolve(env.DATA_DIR);
const YEAR = new Date().getFullYear().toString();
// Keys & Users persist across years, so we don't include the year in the path
const _KEYS_FILE = join(DATA_DIR, "keys.json");
const USERS_FILE = join(DATA_DIR, "users.json");
const SLACK_MAPPINGS_FILE = join(DATA_DIR, "slack.json");
// Reservations, blackouts, site events, and holidays are year-specific
const RESERVATIONS_FILE = join(DATA_DIR, YEAR, "reservations.json");
const BLACKOUTS_FILE = join(DATA_DIR, YEAR, "blackouts.json");
const SITE_EVENTS_FILE = join(DATA_DIR, YEAR, "events.json");
const HOLIDAYS_FILE = join(DATA_DIR, YEAR, "holidays.json");
const HOUSE_TEAMS_FILE = join(DATA_DIR, YEAR, "teams.json");
// Logs file is also year-specific
const LOGS_FILE = join(DATA_DIR, YEAR, "logs.txt");

globalThis.__changeLock ||= new Lock();
const changeLock = globalThis.__changeLock;

// Ensure we're the first thing in this module to grab the change lock
const initializationLock = changeLock.acquire();

async function initialized() {
	const lock = await changeLock.acquire();
	lock();
}

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
	const trimmed = data.trim();

	// Handle empty or whitespace-only files
	if (!trimmed) {
		console.warn(`⚠️ [${MODULE_INSTANCE_ID}] Empty file detected: ${filePath}, treating as empty array`);
		return [];
	}

	try {
		return JSON.parse(trimmed);
	} catch (err) {
		console.error(`❌ [${MODULE_INSTANCE_ID}] Failed to parse JSON from ${filePath}:`, err);
		// If it's genuinely corrupted and not just a race condition, we should fail
		// But for empty/partial writes during startup, treat as empty array
		if (trimmed === "[]" || trimmed.length < 5) {
			return [];
		}
		throw err;
	}
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

function _isHouseTeam(team: Team) {
	return houseTeams.includes(team);
}

function getFilePath(array: unknown[]) {
	if (array === reservations) return RESERVATIONS_FILE;
	if (array === blackouts) return BLACKOUTS_FILE;
	if (array === siteEvents) return SITE_EVENTS_FILE;
	if (array === holidays) return HOLIDAYS_FILE;
	if (array === users) return USERS_FILE;
	if (array === houseTeams) return HOUSE_TEAMS_FILE;
	if (array === slackMappings) return SLACK_MAPPINGS_FILE;
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

	try {
		const data = await readJsonFile(filePath);

		if (!Array.isArray(data)) throw new Error(`Invalid data in ${filePath}`);

		if (array.length > 0) {
			console.log(
				`🔴 [${MODULE_INSTANCE_ID}] REINITIALIZING ${arrayName}: ${array.length} existing items will be replaced with ${data.length} new items - PID: ${process.pid}`,
			);
			array.length = 0;
		}

		if (array === users) usersByAccessToken.clear();

		let strippedDeadFields = false;

		array.push(
			...data.filter(item => {
				// Filter out expired keys
				if (array === users) {
					if (typeof item !== "object" || item === null) return false;
					item.created = new Date(item.created);
					item.updated = new Date(item.updated);
					if (item.disabled) {
						if (item.created < new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2)) return false; // 2 year expiration
					} else if (item.created < new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 1.5)) {
						item.disabled = true;
					}
					const user = item as UserEntry;
					if (user.accessToken) usersByAccessToken.set(user.accessToken, user);
				}

				// Handle holidays with optional created/userId fields
				if (array === holidays) {
					if (typeof item !== "object" || item === null) return false;
					// Convert created to Date if it exists
					if (item.created) {
						item.created = new Date(item.created);
					}
				}

				// Old per-reservation `token` field is dead since we switched to
				// per-user access tokens. Scrub it on load so future writes drop it.
				if (array === reservations) {
					if (typeof item !== "object" || item === null) return false;
					const legacy = item as Reservation & { token?: string };
					if (legacy.token !== undefined) {
						legacy.token = undefined;
						strippedDeadFields = true;
					}
				}

				return true;
			}),
		);

		if (strippedDeadFields && array === reservations) {
			// Persist the cleanup so we don't keep paying it on every boot.
			void writeJsonFile(RESERVATIONS_FILE, reservations).catch(err =>
				console.error("Error persisting reservation cleanup:", err),
			);
		}

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
	if (array === holidays) return "holidays";
	if (array === users) return "users";
	if (array === houseTeams) return "houseTeams";
	if (array === slackMappings) return "slackMappings";
	return "unknown";
}

(async () => {
	const done = await initializationLock; // Wait for the lock to be acquired

	// Skip initialization if already done (HMR persistence)
	if (globalThis.__backendInitialized) {
		done();
		return;
	}

	const jobs: Promise<unknown>[] = [];

	jobs.push(initializePart(reservations));
	jobs.push(initializePart(blackouts));
	jobs.push(initializePart(siteEvents));
	jobs.push(initializePart(holidays));
	jobs.push(initializePart(users));
	jobs.push(initializePart(houseTeams));
	jobs.push(initializePart(slackMappings));

	await Promise.all(jobs);

	globalThis.__backendInitialized = true;
	done();
})().catch(err => {
	console.error(`❌ [${MODULE_INSTANCE_ID}] Error initializing data - PID: ${process.pid}:`, err);
	exit(1); // Exit the process on initialization error
});

// ===== Access (Tool Authorization) =====
/**
 * Look up the user behind a per-user access token and decide whether they
 * currently have access to the given tool. The Gate Manager and other tool
 * integrations call this on every interaction via /api/access/check.
 *
 * Callers must already have authenticated themselves with the scheduler bearer
 * token before reaching here; this function trusts that and just runs policy.
 */
export async function checkAccess(token: string, tool: string): Promise<AccessCheckResult> {
	await initialized();
	const user = usersByAccessToken.get(token);
	return evaluateUserAccess(user, tool, reservations);
}

// ===== Calendar Feed Helpers =====
/**
 * Read-only snapshot of current in-memory data, filtered for public consumption.
 * No auth required.
 */
export async function getPublicFeedData() {
	await initialized();
	// Return shallow copies to avoid accidental mutation by callers
	const res = reservations.filter(r => !r.abandoned).map(r => ({ ...r }));
	const bl = blackouts.filter(b => !b.deleted).map(b => ({ ...b }));
	const ev = siteEvents.filter(e => !e.deleted).map(e => ({ ...e }));
	const hol = holidays.filter(h => !h.deleted).map(h => ({ ...h }));
	return {
		reservations: res,
		blackouts: bl,
		siteEvents: ev,
		holidays: hol,
	} as const;
}
