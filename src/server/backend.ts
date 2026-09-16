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
	PersonalAccess,
	RemoveReservationArgs,
	Reservation,
	SiteEvent,
	Team,
	TeamAccess,
	TeamFull,
	TimeSlot,
	UserEntry,
	UserId,
} from "~/types";
import { type AccessCheckResult, evaluateAccess, isPersonalAccessEligible, sameTeam } from "./access";
import {
	type GateLink,
	notifyTeamOfLink,
	notifyTeamOfReservation,
	selectTeamMemberRecipients,
	sendLinksDm,
} from "./notifications";
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
	var __teamAccess: TeamAccess[] | undefined;
	var __personalAccess: PersonalAccess[] | undefined;
	var __accessByToken: Map<string, IndexedToken> | undefined;
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
globalThis.__teamAccess ||= [];
globalThis.__personalAccess ||= [];
globalThis.__accessByToken ||= new Map();

const reservations = globalThis.__reservations;
const blackouts = globalThis.__blackouts;
const siteEvents = globalThis.__siteEvents;
const holidays = globalThis.__holidays;
const users = globalThis.__users;
const houseTeams = globalThis.__houseTeams;
const slackMappings = globalThis.__slackMappings;
const teamAccess = globalThis.__teamAccess;
const personalAccess = globalThis.__personalAccess;
const accessByToken = globalThis.__accessByToken;

/** What a token in {@link accessByToken} resolves to. */
type IndexedToken = { kind: "team"; entry: TeamAccess } | { kind: "personal"; entry: PersonalAccess };

function newAccessToken(): string {
	// 24 random bytes ⇒ 32 url-safe characters, ~192 bits of entropy.
	return crypto.randomBytes(24).toString("base64url");
}

function findTeamAccess(team: TeamFull): TeamAccess | undefined {
	return teamAccess.find(t => sameTeam(t.team, team));
}

function findPersonalAccess(userId: UserId): PersonalAccess | undefined {
	return personalAccess.find(p => p.userId === userId);
}

type AccessRecord = { token: string; created: Date; rotated?: Date; rotatedBy?: UserId };

/** Everything the issue/rotate machinery needs to know about one link. */
type AccessStore<T extends AccessRecord> = {
	records: T[];
	find: () => T | undefined;
	make: (token: string) => T;
	indexed: (entry: T) => IndexedToken;
	persist: () => Promise<void>;
};

function teamStore(team: TeamFull): AccessStore<TeamAccess> {
	return {
		records: teamAccess,
		find: () => findTeamAccess(team),
		make: token => ({ team, token, created: new Date() }),
		indexed: entry => ({ kind: "team", entry }),
		persist: () => writeJsonFile(TEAM_ACCESS_FILE, teamAccess),
	};
}

function personalStore(userId: UserId): AccessStore<PersonalAccess> {
	return {
		records: personalAccess,
		find: () => findPersonalAccess(userId),
		make: token => ({ userId, token, created: new Date() }),
		indexed: entry => ({ kind: "personal", entry }),
		persist: () => writeJsonFile(PERSONAL_ACCESS_FILE, personalAccess),
	};
}

/**
 * Return the link's record, issuing it first if it doesn't exist yet. Safe to
 * call on every login.
 *
 * Takes `changeLock`. Must NOT be called while already holding it.
 */
async function ensureAccess<T extends AccessRecord>(store: AccessStore<T>): Promise<T> {
	const existing = store.find();
	if (existing) return existing;

	const release = await changeLock.acquire();
	try {
		// Re-check under the lock: concurrent logins race here.
		const raced = store.find();
		if (raced) return raced;

		const entry = store.make(newAccessToken());
		store.records.push(entry);
		accessByToken.set(entry.token, store.indexed(entry));
		await store.persist();
		return entry;
	} finally {
		release();
	}
}

/**
 * Replace a link's token. The old token stops working immediately (it's
 * dropped from the index), so callers are expected to DM the replacement.
 * Issues the link if there wasn't one — that satisfies the request just as well.
 *
 * Takes `changeLock`. Must NOT be called while already holding it.
 */
async function rotateAccess<T extends AccessRecord>(store: AccessStore<T>, rotatedBy: UserId): Promise<T> {
	const release = await changeLock.acquire();
	try {
		const existing = store.find();
		if (!existing) {
			const entry = store.make(newAccessToken());
			store.records.push(entry);
			accessByToken.set(entry.token, store.indexed(entry));
			await store.persist();
			return entry;
		}

		accessByToken.delete(existing.token);
		existing.token = newAccessToken();
		existing.rotated = new Date();
		existing.rotatedBy = rotatedBy;
		accessByToken.set(existing.token, store.indexed(existing));
		await store.persist();
		return existing;
	} finally {
		release();
	}
}

/**
 * Delete a person's link outright. Used when an admin blocks an account: a
 * shared account's link may have spread, so unblocking later must not bring
 * the same token back.
 *
 * Takes `changeLock`. Must NOT be called while already holding it.
 */
async function removePersonalAccess(userId: UserId): Promise<void> {
	const release = await changeLock.acquire();
	try {
		const index = personalAccess.findIndex(p => p.userId === userId);
		if (index === -1) return;
		const [removed] = personalAccess.splice(index, 1);
		if (removed) accessByToken.delete(removed.token);
		await writeJsonFile(PERSONAL_ACCESS_FILE, personalAccess);
	} finally {
		release();
	}
}

/**
 * Record that a user has been DM'd the given tokens, so we don't re-send the
 * same links on every login. Rotation invalidates this naturally: a new token
 * isn't in the list, so the next login re-sends.
 *
 * Takes `changeLock`. Must NOT be called while already holding it.
 */
async function markLinksSent(user: UserEntry, tokens: readonly string[]): Promise<void> {
	const fresh = tokens.filter(t => !user.gateLinkSentTokens?.includes(t));
	if (fresh.length === 0) return;
	const release = await changeLock.acquire();
	try {
		user.gateLinkSentTokens = [...new Set([...(user.gateLinkSentTokens ?? []), ...fresh])];
		await writeJsonFile(USERS_FILE, users);
	} finally {
		release();
	}
}

/** Every Slack ID mapped to a user — rotation DMs reach all of them. */
function slackIdsFor(userId: UserId): string[] {
	return slackMappings.filter(m => m.userId === userId).map(m => m.slackId);
}

/**
 * Make sure this user holds every link they're entitled to — one per team they
 * belong to, plus a personal link if they're an approved member — and DM them,
 * in a single message, any they haven't been sent yet. Covers first login,
 * joining a team, becoming eligible and picking up a rotation, all through the
 * same path.
 *
 * Never throws: logs failures so a Slack hiccup can't break login.
 *
 * Takes `changeLock` (via helpers). Must NOT be called while holding it.
 */
async function ensureLinksForUser(user: UserEntry, slackId: string): Promise<void> {
	const unsent: GateLink[] = [];
	const wanted = (token: string) => !user.gateLinkSentTokens?.includes(token);

	try {
		if (isPersonalAccessEligible(user)) {
			const entry = await ensureAccess(personalStore(user.id));
			if (wanted(entry.token)) unsent.push({ kind: "personal", token: entry.token });
		}

		if (user.teams !== "admin") {
			for (const team of user.teams) {
				const entry = await ensureAccess(teamStore(team));
				if (wanted(entry.token)) unsent.push({ kind: "team", team: entry.team, token: entry.token });
			}
		}
	} catch (err) {
		console.error(`Failed issuing gate links for user ${user.id}:`, err);
		return;
	}

	if (unsent.length === 0) return;

	const outcome = await sendLinksDm(slackId, unsent, "issued");
	if (!outcome.sent) {
		console.warn(
			`Gate link DM not sent to user ${user.id} (slack ${slackId}): ${outcome.reason}${
				outcome.error ? ` - ${outcome.error}` : ""
			}`,
		);
		return;
	}
	await markLinksSent(
		user,
		unsent.map(l => l.token),
	).catch(err => console.error(`Failed recording sent gate links for user ${user.id}:`, err));
}

/** Kick off {@link ensureLinksForUser} without blocking the login path. */
function fireLinkDms(user: UserEntry, slackId: string): void {
	void ensureLinksForUser(user, slackId);
}

/**
 * Fire-and-forget DMs to every member of the reservation's team (excluding the
 * creator), carrying the team's link — issued now if the team has none yet.
 * Best-effort: logs failures but never blocks the caller.
 *
 * Must be called after the caller has released `changeLock`.
 */
function fireReservationDmsForTeam(reservation: Reservation, excludeUserId: UserId): void {
	const { recipients } = selectTeamMemberRecipients(users, slackMappings, reservation.team, excludeUserId);
	if (recipients.length === 0) return;

	void (async () => {
		const entry = await ensureAccess(teamStore(reservation.team));
		const outcomes = await notifyTeamOfReservation(reservation, recipients, entry.token);

		const failed = outcomes.filter(o => !o.sent);
		if (failed.length > 0) {
			console.warn(
				`Reservation ${reservation.id}: ${failed.length}/${outcomes.length} DM(s) failed:`,
				failed.map(f => `${f.userId}/${f.slackUserId}: ${f.error ?? f.reason}`),
			);
		}

		// The reminder carried the link, so the next login needn't send it again.
		for (const o of outcomes.filter(o => o.sent)) {
			const user = users.find(u => u.id === o.userId);
			if (user) await markLinksSent(user, [entry.token]);
		}
	})().catch(err => console.error(`Reservation ${reservation.id} DM batch failed:`, err));
}

/**
 * Update a stored user record to match the fresh values from the current Slack
 * session:
 *   - Re-sync `name` / `displayName` if Slack reports new values.
 *   - If the display name parses as "First Last (1234[, 5678...])", treat it as
 *     authoritative and update `teams` to match (admins are skipped).
 *
 * Persists the users file if anything changed. Logs a warning if the name does
 * not parse; the actual login block when STRICT_SLACK_NAMES is on happens in
 * the NextAuth signIn callback.
 *
 * Takes `changeLock`. Must NOT be called while already holding it.
 */
async function syncUserFromSession(
	user: UserEntry,
	sessionName: string | undefined,
	sessionDisplayName: string | undefined,
): Promise<void> {
	let dirty = false;

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
			user.teams = wanted;
			dirty = true;
		}
	} else if (!parsed) {
		console.warn(`User ${user.id} has an invalid Slack name format: ${JSON.stringify(candidate)}`);
	}

	if (!dirty) return;

	user.updated = new Date();
	const release = await changeLock.acquire();
	try {
		await writeJsonFile(USERS_FILE, users);
	} catch (err) {
		console.error("Error persisting user sync:", err);
	} finally {
		release();
	}
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

/**
 * Team-link administration. Worth auditing on its own: revealing a shared
 * secret and invalidating a whole team's bookmarks are both things you want
 * to be able to attribute after the fact.
 */
type LogTeamAccessEntry = LogCommon & {
	type: "teamLinkReveal" | "teamLinkRotate";
	team: TeamFull;
};

/** Personal-link administration, attributed to the admin who did it. */
type LogPersonalAccessEntry = LogCommon & {
	type: "personalLinkReveal" | "personalLinkRotate" | "personalLinkBlock" | "personalLinkUnblock";
	targetUserId: UserId;
	targetName: string;
};

type LogEntry =
	| LogReservationEntry
	| LogBlackoutEntry
	| LogSiteEventEntry
	| LogUserEntry
	| LogTeamAccessEntry
	| LogPersonalAccessEntry;

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
			await syncUserFromSession(user, sessionName, sessionDisplayName);
			fireLinkDms(user, slackId);
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

				await syncUserFromSession(existingUser, sessionName, sessionDisplayName);
				fireLinkDms(existingUser, slackId);
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
		};

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

		fireLinkDms(newUser, slackId);

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
	 * Admin-only: summary of every team's shared gate link.
	 *
	 * Deliberately omits the token itself — it's a bearer secret, and the
	 * listing is rendered for every team at once. Use {@link revealTeamAccessLink}
	 * for the one team an admin actually needs to hand over.
	 *
	 * Teams are drawn from user membership *and* existing access records, so a
	 * team keeps its row even after its last member's Slack name breaks.
	 */
	async listTeamAccess(): Promise<
		Array<{ team: TeamFull; hasLink: boolean; created: Date | null; rotated: Date | null; memberCount: number }>
	> {
		await this.assertAdmin("Only admins can view team access");
		await initialized();

		const teams = new Map<string, TeamFull>();
		for (const user of users) {
			if (user.disabled) continue;
			if (user.teams === "admin") continue;
			for (const team of user.teams) teams.set(String(team), team);
		}
		for (const entry of teamAccess) teams.set(String(entry.team), entry.team);

		return [...teams.values()]
			.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
			.map(team => {
				const entry = findTeamAccess(team);
				return {
					team,
					hasLink: Boolean(entry),
					created: entry?.created ?? null,
					rotated: entry?.rotated ?? null,
					memberCount: users.filter(u => !u.disabled && u.teams !== "admin" && u.teams.some(t => sameTeam(t, team)))
						.length,
				};
			});
	}

	/**
	 * Admin-only: reveal one team's actual gate link, for handing over when
	 * Slack DMs aren't reaching someone. Issues the link if the team doesn't
	 * have one yet, so "reveal" always returns something usable.
	 *
	 * Logged, because revealing a shared secret is worth an audit trail.
	 */
	async revealTeamAccessLink(team: TeamFull): Promise<{ team: TeamFull; token: string }> {
		await this.assertAdmin("Only admins can reveal team access links");
		await initialized();

		const entry = await ensureAccess(teamStore(team));

		const ctx = await this.getContext();
		await log({ ...ctx, type: "teamLinkReveal", team: entry.team });

		return { team: entry.team, token: entry.token };
	}

	/**
	 * Admin-only: rotate a team's shared gate link. Every existing bookmark for
	 * that team stops working immediately, so the team is DM'd the new link
	 * right away. Anyone the DM misses picks it up on their next login, because
	 * the new token won't be in their `gateLinkSentTokens`.
	 */
	async rotateTeamAccessLink(team: TeamFull): Promise<{ team: TeamFull; notified: number; failed: number }> {
		await this.assertAdmin("Only admins can rotate team access links");
		await initialized();

		const admin = await this.user;
		const entry = await rotateAccess(teamStore(team), admin.id);

		const ctx = await this.getContext();
		await log({ ...ctx, type: "teamLinkRotate", team: entry.team });

		// DM the whole team, including the admin if they're on it — everyone's
		// old bookmark just died.
		const { recipients } = selectTeamMemberRecipients(users, slackMappings, team, null);
		const outcomes = await notifyTeamOfLink(entry.team, entry.token, recipients);

		for (const o of outcomes.filter(o => o.sent)) {
			const user = users.find(u => u.id === o.userId);
			if (user) await markLinksSent(user, [entry.token]);
		}

		const failed = outcomes.filter(o => !o.sent);
		if (failed.length > 0) {
			console.warn(
				`Team ${team} link rotation: ${failed.length}/${outcomes.length} DM(s) failed:`,
				failed.map(f => `${f.userId}/${f.slackUserId}: ${f.error ?? f.reason}`),
			);
		}

		return { team: entry.team, notified: outcomes.length - failed.length, failed: failed.length };
	}

	/**
	 * Admin-only: personal-link status for every user, keyed by user ID. Like
	 * the team listing, it never includes the token itself.
	 */
	async listPersonalAccess(): Promise<
		Record<
			UserId,
			{
				status: "active" | "not_issued" | "blocked" | "invalid_name" | "disabled";
				created: Date | null;
				rotated: Date | null;
			}
		>
	> {
		await this.assertAdmin("Only admins can view personal access");
		await initialized();

		const out: Awaited<ReturnType<Context["listPersonalAccess"]>> = {};
		for (const user of users) {
			const entry = findPersonalAccess(user.id);
			const status = user.disabled
				? "disabled"
				: user.personalAccessBlocked
					? "blocked"
					: !isPersonalAccessEligible(user)
						? "invalid_name"
						: entry
							? "active"
							: "not_issued";
			out[user.id] = { status, created: entry?.created ?? null, rotated: entry?.rotated ?? null };
		}
		return out;
	}

	/** Look up a user an admin action targets, refusing ones that can't hold a link. */
	private eligibleTarget(userId: UserId): UserEntry {
		const target = users.find(u => u.id === userId);
		if (!target) throw new Error("User not found");
		if (!isPersonalAccessEligible(target)) {
			throw new Error(
				target.personalAccessBlocked
					? "This account is blocked from having a personal link"
					: target.disabled
						? "This account is disabled"
						: "This account's Slack name isn't in the expected format, so it can't have a personal link",
			);
		}
		return target;
	}

	/**
	 * Admin-only: reveal one person's link, for handing over when Slack DMs
	 * aren't reaching them. Issues it if needed. Logged.
	 */
	async revealPersonalAccessLink(userId: UserId): Promise<{ userId: UserId; token: string }> {
		await this.assertAdmin("Only admins can reveal personal access links");
		await initialized();

		const target = this.eligibleTarget(userId);
		const entry = await ensureAccess(personalStore(target.id));

		const ctx = await this.getContext();
		await log({
			...ctx,
			type: "personalLinkReveal",
			targetUserId: target.id,
			targetName: target.displayName ?? target.name,
		});

		return { userId: target.id, token: entry.token };
	}

	/**
	 * Admin-only: rotate one person's link and DM them the replacement on every
	 * Slack account mapped to them. The old link stops working immediately.
	 */
	async rotatePersonalAccessLink(userId: UserId): Promise<{ userId: UserId; notified: number; failed: number }> {
		await this.assertAdmin("Only admins can rotate personal access links");
		await initialized();

		const target = this.eligibleTarget(userId);
		const admin = await this.user;
		const entry = await rotateAccess(personalStore(target.id), admin.id);

		const ctx = await this.getContext();
		await log({
			...ctx,
			type: "personalLinkRotate",
			targetUserId: target.id,
			targetName: target.displayName ?? target.name,
		});

		let notified = 0;
		let failed = 0;
		for (const slackId of slackIdsFor(target.id)) {
			const outcome = await sendLinksDm(slackId, [{ kind: "personal", token: entry.token }], "rotated");
			if (outcome.sent) notified++;
			else {
				failed++;
				console.warn(`Personal link rotation DM to ${target.id}/${slackId} failed: ${outcome.error ?? outcome.reason}`);
			}
		}
		if (notified > 0) await markLinksSent(target, [entry.token]);

		return { userId: target.id, notified, failed };
	}

	/**
	 * Admin-only: mark an account as shared/unverified (no personal link), or
	 * clear that mark. Blocking deletes the existing link outright — a shared
	 * account's link may have spread — so unblocking issues a fresh one on the
	 * person's next login rather than resurrecting the old one.
	 */
	async setPersonalAccessBlocked(userId: UserId, blocked: boolean): Promise<void> {
		await this.assertAdmin("Only admins can block personal access");
		await initialized();

		const target = users.find(u => u.id === userId);
		if (!target) throw new Error("User not found");

		if (Boolean(target.personalAccessBlocked) !== blocked) {
			const release = await changeLock.acquire();
			try {
				target.personalAccessBlocked = blocked ? true : undefined;
				target.updated = new Date();
				await writeJsonFile(USERS_FILE, users);
			} finally {
				release();
			}
		}
		if (blocked) await removePersonalAccess(target.id);

		const ctx = await this.getContext();
		await log({
			...ctx,
			type: blocked ? "personalLinkBlock" : "personalLinkUnblock",
			targetUserId: target.id,
			targetName: target.displayName ?? target.name,
		});
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
// Access links are per season: the server restarts when the year changes, and
// a new year's empty files mean everyone is issued (and DM'd) fresh links.
const TEAM_ACCESS_FILE = join(DATA_DIR, YEAR, "teamAccess.json");
const PERSONAL_ACCESS_FILE = join(DATA_DIR, YEAR, "personalAccess.json");
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
	if (array === teamAccess) return TEAM_ACCESS_FILE;
	if (array === personalAccess) return PERSONAL_ACCESS_FILE;
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

		// Both link stores share one token index; drop only this store's entries.
		const reloadingKind = array === teamAccess ? "team" : array === personalAccess ? "personal" : null;
		if (reloadingKind) {
			for (const [token, indexed] of accessByToken) {
				if (indexed.kind === reloadingKind) accessByToken.delete(token);
			}
		}

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
					// The per-user token model was replaced by per-team links; scrub the
					// dead field so future writes drop it.
					const legacyUser = item as UserEntry & { accessToken?: string };
					if (legacyUser.accessToken !== undefined) {
						legacyUser.accessToken = undefined;
						strippedDeadFields = true;
					}
				}

				// Handle holidays with optional created/userId fields
				if (array === holidays) {
					if (typeof item !== "object" || item === null) return false;
					// Convert created to Date if it exists
					if (item.created) {
						item.created = new Date(item.created);
					}
				}

				// Access records: revive dates and rebuild the token index that
				// /api/access/check reads on every call.
				if (array === teamAccess || array === personalAccess) {
					if (typeof item !== "object" || item === null) return false;
					const record = item as AccessRecord;
					if (!record.token) return false;
					record.created = new Date(record.created);
					if (record.rotated) record.rotated = new Date(record.rotated);

					if (array === teamAccess) {
						const entry = item as TeamAccess;
						if (entry.team === undefined || entry.team === null) return false;
						accessByToken.set(entry.token, { kind: "team", entry });
					} else {
						const entry = item as PersonalAccess;
						if (!entry.userId) return false;
						accessByToken.set(entry.token, { kind: "personal", entry });
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

		if (strippedDeadFields) {
			// Persist the cleanup so we don't keep paying it on every boot.
			void writeJsonFile(filePath, array as JsonData).catch(err =>
				console.error(`Error persisting ${arrayName} cleanup:`, err),
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
	if (array === teamAccess) return "teamAccess";
	if (array === personalAccess) return "personalAccess";
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
	jobs.push(initializePart(teamAccess));
	jobs.push(initializePart(personalAccess));

	await Promise.all(jobs);

	globalThis.__backendInitialized = true;
	done();
})().catch(err => {
	console.error(`❌ [${MODULE_INSTANCE_ID}] Error initializing data - PID: ${process.pid}:`, err);
	exit(1); // Exit the process on initialization error
});

// ===== Access (Tool Authorization) =====
/**
 * Resolve an access token (team or personal) and decide whether it currently
 * grants the given tool. Gate Manager and other tool integrations call this on
 * every interaction via /api/access/check.
 *
 * Callers must already have authenticated themselves with the scheduler bearer
 * token before reaching here; this function trusts that and just runs policy.
 */
export async function checkAccess(token: string, tool: string): Promise<AccessCheckResult> {
	await initialized();
	const indexed = accessByToken.get(token);
	if (!indexed) return evaluateAccess(undefined, tool, reservations);

	if (indexed.kind === "team") return evaluateAccess({ kind: "team", team: indexed.entry.team }, tool, reservations);

	// Resolve the live user so disabling, blocking or a broken Slack name takes
	// effect immediately. A link whose user has since expired grants nothing.
	const user = users.find(u => u.id === indexed.entry.userId);
	return evaluateAccess(user ? { kind: "personal", user } : undefined, tool, reservations);
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
