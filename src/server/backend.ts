/**
 * Backend for the reservation system.
 *
 * This file contains the backend logic for managing reservations, blackouts, site events, and keys.
 * It handles write permissions for keys.
 * It also handles data storage and retrieval using JSON files.
 * All APIs here expect safe data, so they don't do any validation.
 */

import crypto from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import type { Session } from "next-auth";
import { env } from "~/env";
import type {
	AddBlackoutArgs,
	AddReservationArgs,
	Blackout,
	EventDate,
	Holiday,
	PersonalAccess,
	PersonalAccessStatus,
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
import {
	type AccessCheckResult,
	evaluateAccess,
	hasValidSlackNames,
	isPersonalAccessEligible,
	sameTeam,
	slackNameCheckFor,
} from "./access";
import {
	type GateLink,
	type LinkDmKind,
	type NameFixReason,
	notifyTeamOfLink,
	notifyTeamOfReservation,
	selectTeamMemberRecipients,
	sendLinksDm,
	sendNameFixDm,
} from "./notifications";
import {
	getSlackMember,
	isMissingScope,
	isSlackConfigured,
	isSlackUserId,
	listSlackMembers,
	lookupSlackMemberByEmail,
	SlackApiError,
	type SlackMember,
	SlackNotConfiguredError,
} from "./slack";
import { activeBlackouts, blackoutCoversSlot, findBlackoutForSlot, normalizeBlackoutRange } from "./util/blackout";
import { exit } from "./util/exit";
import type { JsonData } from "./util/JsonData";
import { Lock } from "./util/Lock";
import { checkSlackNames, parseSlackName, type SlackNameIssue, type SuggestedNames } from "./util/slackName";
import { addFieldDays, fieldToday } from "./util/slotTime";
import {
	tellClientsAboutBlackoutChange,
	tellClientsAboutReservationChange,
	tellClientsAboutSiteEvent,
} from "./websocket";

const FirstUserIsAdmin = true; // If true, the first user created will be an admin
const ContinueOnError = true; // If true, the server will continue running even if an error occurs
const AdvancedReservationDays = 7; // Number of days in the future that reservations can be made
// If true, a non-admin may only book for a team they're recorded as belonging to.
// Off, because the data isn't there yet: almost no user record lists a team, so
// enforcing it locks nearly everyone out (and it was silently never enforced for
// over a year -- two commits adding a missing `await` turned it on by accident).
// Refusals are logged either way, so the journal shows what enabling this would
// block. Turn it on once user records carry teams. See plans/booking-regression.md.
const EnforceTeamMembership = false;
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
	var __slackRoster: SlackRoster | undefined;
	var __slackNamesRefreshedAt: Map<UserId, number> | undefined;
	var __slackNameSyncTimer: ReturnType<typeof setInterval> | undefined;
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
globalThis.__slackRoster ||= { status: "never", attemptedAt: null, checkedAt: null, error: null, members: [] };
globalThis.__slackNamesRefreshedAt ||= new Map();

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
const slackRoster = globalThis.__slackRoster;
const slackNamesRefreshedAt = globalThis.__slackNamesRefreshedAt;

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
 * Delete a person's link outright. Used when an admin revokes general gate
 * access: the link may have spread, so approving again later must issue a new
 * token rather than bring the old one back.
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

/** Every Slack ID mapped to a user — admin-triggered DMs reach all of them. */
function slackIdsFor(userId: UserId): string[] {
	return slackMappings.filter(m => m.userId === userId).map(m => m.slackId);
}

/**
 * The real Slack user id behind a session whose id isn't one.
 *
 * Sessions issued before the `jwt` callback in auth/config.ts carry a random
 * UUID as `user.id`. The person is found by the email on their Slack profile
 * (`users.lookupByEmail`) and the answer remembered per session id, so such a
 * session costs one Slack call, not one per request. A miss is remembered too,
 * and retried after a while in case Slack was just unreachable.
 */
const slackIdBySessionId = new Map<string, { slackId: string | null; at: number }>();
const SLACK_ID_MISS_RETRY_MS = 5 * 60 * 1000;

async function resolveSlackIdByEmail(sessionId: string, email: string): Promise<string | null> {
	if (!email || !isSlackConfigured()) return null;
	const known = slackIdBySessionId.get(sessionId);
	if (known && (known.slackId !== null || Date.now() - known.at < SLACK_ID_MISS_RETRY_MS)) return known.slackId;

	let slackId: string | null = null;
	try {
		const member = await lookupSlackMemberByEmail(email);
		slackId = member?.id ?? null;
		if (!slackId) console.warn(`No Slack account found by email for session ${sessionId}`);
	} catch (err) {
		const { status, error } = statusForSlackError(err);
		console.warn(`Couldn't look up a Slack account by email for session ${sessionId} (${status}): ${error}`);
	}
	slackIdBySessionId.set(sessionId, { slackId, at: Date.now() });
	return slackId;
}

/**
 * Drop mappings whose "Slack id" isn't one. For over a year every sign-in
 * stored a fresh random UUID here (see the `jwt` callback in auth/config.ts),
 * so the file held hundreds of entries that matched nothing in Slack. A
 * session still carrying such an id is matched by email instead.
 *
 * Runs once at startup, while initialization holds `changeLock`.
 */
async function pruneNonSlackMappings() {
	if (DisableWrites) return;

	// An entry only goes when its person can still be found without it: by a
	// real mapping, or by email. Anyone else keeps theirs, and `getUser` still
	// honours it, so nobody ends up with a duplicate user record.
	const hasRealMapping = new Set(slackMappings.filter(m => isSlackUserId(m.slackId)).map(m => m.userId));
	const findableWithout = (userId: UserId) =>
		hasRealMapping.has(userId) || Boolean(users.find(u => u.id === userId)?.email?.trim());
	const kept = slackMappings.filter(m => isSlackUserId(m.slackId) || !findableWithout(m.userId));
	const removed = slackMappings.length - kept.length;
	if (removed === 0) return;

	// The file is the whole gate-links feature's memory of who is who: copy it
	// aside first, so there is an undo.
	const backup = `${SLACK_MAPPINGS_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
	try {
		await copyFile(SLACK_MAPPINGS_FILE, backup);
	} catch (err) {
		console.error(
			`❌ [${MODULE_INSTANCE_ID}] Not pruning Slack mappings: couldn't back up ${SLACK_MAPPINGS_FILE}:`,
			err,
		);
		return;
	}

	slackMappings.splice(0, slackMappings.length, ...kept);
	console.warn(
		`⚠️ [${MODULE_INSTANCE_ID}] Removed ${removed} Slack mapping(s) that weren't Slack user ids (backup: ${backup})`,
	);
	await writeJsonFile(SLACK_MAPPINGS_FILE, slackMappings);
}

/** What happened when we tried to DM someone their personal link. */
export type LinkDelivery = {
	notified: number;
	failed: number;
	/** Why nothing was attempted, if nothing was. */
	skipped: "slack_not_configured" | "no_slack_account" | null;
};

/**
 * DM a person their personal link on every Slack account mapped to them, and
 * record it as sent if any DM got through.
 *
 * Takes `changeLock` (via helpers). Must NOT be called while holding it.
 */
async function deliverPersonalLink(user: UserEntry, token: string, kind: LinkDmKind): Promise<LinkDelivery> {
	if (!isSlackConfigured()) return { notified: 0, failed: 0, skipped: "slack_not_configured" };
	const slackIds = slackIdsFor(user.id);
	if (slackIds.length === 0) return { notified: 0, failed: 0, skipped: "no_slack_account" };

	let notified = 0;
	let failed = 0;
	for (const slackId of slackIds) {
		const outcome = await sendLinksDm(slackId, [{ kind: "personal", token }], kind);
		if (outcome.sent) notified++;
		else {
			failed++;
			console.warn(`Personal link DM to ${user.id}/${slackId} failed: ${outcome.error ?? outcome.reason}`);
		}
	}
	if (notified > 0) await markLinksSent(user, [token]);
	return { notified, failed, skipped: null };
}

/**
 * Make sure this user holds every link they're entitled to — one per team they
 * belong to, plus a personal link if they're an approved member — and DM them,
 * in a single message, any they haven't been sent yet. Covers first login,
 * joining a team, becoming eligible, fixing their Slack names and picking up a
 * rotation, all through the same path.
 *
 * While their Slack names are wrong, nothing is issued or sent; instead they're
 * told (once per wrong pair of names) what to fix.
 *
 * Never throws: logs failures so a Slack hiccup can't break login.
 *
 * Takes `changeLock` (via helpers). Must NOT be called while holding it.
 */
async function ensureLinksForUser(user: UserEntry, slackId: string): Promise<void> {
	if (!hasValidSlackNames(user)) {
		await nudgeAboutNames(user, slackId, "links_held");
		return;
	}

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

/** How long a request waits for a newcomer's first name check. */
const FIRST_NAME_CHECK_WAIT_MS = 3_000;

/**
 * For someone whose names have never been read from Slack, wait (briefly) for
 * the first read, so their first page already shows the teams their display
 * name gives. Everyone else is refreshed in the background.
 */
async function awaitFirstNameCheck(user: UserEntry, slackId: string): Promise<void> {
	if (user.slackNamesSyncedAt || !isSlackConfigured()) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>(resolve => {
		timer = setTimeout(resolve, FIRST_NAME_CHECK_WAIT_MS);
	});
	await Promise.race([refreshSlackNames(user, slackId), timeout]);
	clearTimeout(timer);
}

/**
 * Refresh the user's Slack names, then {@link ensureLinksForUser}, without
 * blocking the request. Runs on every request; both steps are cheap when
 * nothing has changed.
 */
function fireLinkDms(user: UserEntry, slackId: string): void {
	void (async () => {
		await refreshSlackNames(user, slackId);
		await ensureLinksForUser(user, slackId);
	})();
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

		// Where the notice carried the link, the next login needn't send it again.
		const gotLink = new Set(recipients.filter(r => r.withLink).map(r => r.user.id));
		for (const o of outcomes.filter(o => o.sent && gotLink.has(o.userId))) {
			const user = users.find(u => u.id === o.userId);
			if (user) await markLinksSent(user, [entry.token]);
		}
	})().catch(err => console.error(`Reservation ${reservation.id} DM batch failed:`, err));
}

/** Persist the users file after an in-place change, taking the lock. */
async function saveUsers(context: string): Promise<void> {
	const release = await changeLock.acquire();
	try {
		await writeJsonFile(USERS_FILE, users);
	} catch (err) {
		console.error(`Error persisting users (${context}):`, err);
	} finally {
		release();
	}
}

/** Set `teams` from an affiliation, sorted. Returns whether anything changed. Admins keep "admin". */
function applyTeams(user: UserEntry, teams: readonly Team[]): boolean {
	if (user.teams === "admin") return false;
	const wanted = [...teams].sort((a, b) => a - b);
	const current = [...user.teams].sort((a, b) => a - b);
	if (wanted.length === current.length && wanted.every((t, i) => t === current[i])) return false;
	user.teams = wanted;
	return true;
}

/**
 * Keep a stored user in step with their session, but only until Slack's Web
 * API has given us their real names. Sign in with Slack only carries a `name`
 * claim, which may be either Slack name; once {@link applySlackMember} has run,
 * the session is ignored so the two sources don't fight.
 *
 * Until then, teams are read from that `name` as before, so booking keeps
 * working where the Web API isn't available. Gate links stay held regardless:
 * unverified names never pass {@link hasValidSlackNames}.
 *
 * Takes `changeLock`. Must NOT be called while already holding it.
 */
async function syncUserFromSession(user: UserEntry, sessionName: string | undefined): Promise<void> {
	if (user.slackNamesSyncedAt) return;

	let dirty = false;
	if (sessionName && sessionName !== user.name) {
		user.name = sessionName;
		dirty = true;
	}
	const parsed = parseSlackName(user.name);
	if (parsed && applyTeams(user, parsed.teams)) dirty = true;

	if (!dirty) return;
	user.updated = new Date();
	await saveUsers("session sync");
}

// ===== Slack names =====
//
// Names come from Slack's Web API (`users.info` / `users.list`, bot scope
// `users:read`), the only source that has both the full name and the display
// name. Gate links wait on both following the rules; see
// `plans/gate-access-integration.md`, "Slack name rules".

/** How often every workspace member's names are re-read. */
export const SLACK_NAME_SYNC_INTERVAL_MS = 10 * 60 * 1000;

/** A signed-in person's names are re-read at most this often. */
export const SLACK_NAME_REFRESH_MS = 5 * 60 * 1000;

/** Wait this long after startup before the first workspace sync. */
const SLACK_NAME_FIRST_SYNC_DELAY_MS = 5_000;

export type SlackNameSyncStatus = "never" | "ok" | "not_configured" | "missing_scope" | "error";

type SlackRoster = {
	status: SlackNameSyncStatus;
	/** When the last workspace sync finished, whether or not it worked. */
	attemptedAt: Date | null;
	/** When `members` was fetched. */
	checkedAt: Date | null;
	error: string | null;
	members: SlackMember[];
};

function statusForSlackError(err: unknown): { status: SlackNameSyncStatus; error: string } {
	if (err instanceof SlackNotConfiguredError) return { status: "not_configured", error: err.message };
	if (isMissingScope(err)) return { status: "missing_scope", error: "The Slack bot token lacks the users:read scope" };
	if (err instanceof SlackApiError) return { status: "error", error: err.slackError };
	return { status: "error", error: (err as Error).message };
}

/** How a user's name check moved when Slack's values were applied. */
type NameChange = { firstCheck: boolean; wasOk: boolean; isOk: boolean };

/**
 * Store what Slack says a user's names are, and the teams their display name
 * gives, when it follows the rules. A deactivated Slack account un-verifies
 * the user, which holds their links.
 *
 * Takes `changeLock` (to save). Must NOT be called while holding it.
 */
async function applySlackMember(user: UserEntry, member: SlackMember): Promise<NameChange> {
	const firstCheck = !user.slackNamesSyncedAt;
	const wasOk = hasValidSlackNames(user);

	if (member.deleted) {
		if (!firstCheck) {
			user.slackNamesSyncedAt = undefined;
			user.updated = new Date();
			await saveUsers("Slack account deactivated");
		}
		return { firstCheck, wasOk, isOk: false };
	}

	const realName = member.realName.trim();
	const displayName = member.displayName.trim() || undefined;
	const check = checkSlackNames({ realName, displayName });

	let dirty = firstCheck;
	if (realName !== user.name) {
		user.name = realName;
		dirty = true;
	}
	if (displayName !== user.displayName) {
		user.displayName = displayName;
		dirty = true;
	}
	if (check.affiliation && applyTeams(user, check.affiliation.teams)) dirty = true;

	if (dirty) {
		const now = new Date();
		user.slackNamesSyncedAt = now;
		user.updated = now;
		await saveUsers("Slack names");
	}
	return { firstCheck, wasOk, isOk: check.ok };
}

/**
 * Act on a change in someone's names. Fixed names release their links at
 * once; newly broken ones get a DM saying what to fix. A first check does
 * neither: the caller decides, so the first sync after a deploy doesn't DM
 * everyone.
 */
async function reactToNameChange(user: UserEntry, slackId: string, change: NameChange): Promise<void> {
	if (change.firstCheck || change.wasOk === change.isOk) return;
	if (change.isOk) await ensureLinksForUser(user, slackId);
	else await nudgeAboutNames(user, slackId, "links_held");
}

/** The pair of names a nudge was about, so each wrong pair is raised once. */
function nameNudgeKey(user: Pick<UserEntry, "name" | "displayName">): string {
	return JSON.stringify([user.name ?? "", user.displayName ?? ""]);
}

const nudgesInFlight = new Set<UserId>();

/**
 * DM someone what's wrong with their Slack names, unless they've already been
 * told about this exact pair. Does nothing when the names are fine, or when
 * they've never been read from Slack (we can't say what's wrong).
 *
 * Takes `changeLock` (to save). Must NOT be called while holding it.
 */
async function nudgeAboutNames(user: UserEntry, slackId: string, reason: NameFixReason): Promise<boolean> {
	const check = slackNameCheckFor(user);
	if (check.ok || check.issues.includes("unverified")) return false;
	const key = nameNudgeKey(user);
	if (user.slackNameNudgeSentFor === key || nudgesInFlight.has(user.id)) return false;

	nudgesInFlight.add(user.id);
	try {
		const outcome = await sendNameFixDm(slackId, { realName: user.name, displayName: user.displayName }, check, reason);
		if (!outcome.sent) {
			if (outcome.reason !== "slack_not_configured") {
				console.warn(`Name-fix DM to ${user.id}/${slackId} failed: ${outcome.error ?? outcome.reason}`);
			}
			return false;
		}
		user.slackNameNudgeSentFor = key;
		await saveUsers("name nudge");
		return true;
	} finally {
		nudgesInFlight.delete(user.id);
	}
}

const refreshesInFlight = new Map<UserId, Promise<void>>();

/**
 * Re-read one signed-in person's names (`users.info`), at most once every
 * {@link SLACK_NAME_REFRESH_MS}. Never throws.
 *
 * Takes `changeLock` (via helpers). Must NOT be called while holding it.
 */
async function refreshSlackNames(user: UserEntry, slackId: string): Promise<void> {
	if (!isSlackConfigured()) return;
	const running = refreshesInFlight.get(user.id);
	if (running) return running;
	const last = slackNamesRefreshedAt.get(user.id);
	if (last !== undefined && Date.now() - last < SLACK_NAME_REFRESH_MS) return;
	slackNamesRefreshedAt.set(user.id, Date.now());

	const run = (async () => {
		try {
			const member = await getSlackMember(slackId);
			if (!member) return;
			const change = await applySlackMember(user, member);
			await reactToNameChange(user, slackId, change);
		} catch (err) {
			const { status, error } = statusForSlackError(err);
			console.warn(`Couldn't read Slack names for ${user.id}/${slackId} (${status}): ${error}`);
		}
	})().finally(() => refreshesInFlight.delete(user.id));
	refreshesInFlight.set(user.id, run);
	return run;
}

let workspaceSync: Promise<void> | null = null;

/**
 * Re-read every workspace member's names (`users.list`), update the people
 * who use the scheduler, and remember the list for the admin audit. One sync
 * at a time; callers share a running one. Never throws.
 *
 * Takes `changeLock` (via helpers). Must NOT be called while holding it.
 */
export function syncSlackNames(): Promise<void> {
	workspaceSync ??= (async () => {
		await initialized();
		let members: SlackMember[];
		try {
			members = await listSlackMembers();
		} catch (err) {
			const { status, error } = statusForSlackError(err);
			Object.assign(slackRoster, { status, error, attemptedAt: new Date() });
			if (status !== "not_configured") console.warn(`Slack name sync failed (${status}): ${error}`);
			return;
		}

		const now = new Date();
		Object.assign(slackRoster, { status: "ok", error: null, attemptedAt: now, checkedAt: now, members });

		const byId = new Map(members.map(m => [m.id, m]));
		for (const user of [...users]) {
			if (user.disabled) continue;
			const found = slackIdsFor(user.id)
				.map(id => byId.get(id))
				.filter((m): m is SlackMember => m !== undefined);
			const member = found.find(m => !m.deleted) ?? found[0];
			if (!member) continue;
			slackNamesRefreshedAt.set(user.id, Date.now());
			try {
				const change = await applySlackMember(user, member);
				await reactToNameChange(user, member.id, change);
			} catch (err) {
				console.error(`Slack name sync failed for user ${user.id}:`, err);
			}
		}
	})().finally(() => {
		workspaceSync = null;
	});
	return workspaceSync;
}

/**
 * Start the periodic workspace sync. Not during `next build`, which loads the
 * real data directory and must not DM anyone or write to it, and not under
 * Vitest, where tests drive syncs themselves.
 */
function startSlackNameSync(): void {
	if (globalThis.__slackNameSyncTimer) return;
	if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD || process.env.VITEST) return;
	const run = () => void syncSlackNames();
	globalThis.__slackNameSyncTimer = setInterval(run, SLACK_NAME_SYNC_INTERVAL_MS);
	globalThis.__slackNameSyncTimer.unref();
	setTimeout(run, SLACK_NAME_FIRST_SYNC_DELAY_MS).unref();
}

/** A person's own Slack names, as the calendar shows them. See `Context.getMySlackNames`. */
export type MySlackNames = {
	/** False when Slack couldn't identify the session by email; links are held until they sign in again. */
	identified: boolean;
	realName: string;
	displayName: string | null;
	/** When the names were last read from Slack; null if never (then `issues` is ["unverified"]). */
	syncedAt: Date | null;
	ok: boolean;
	issues: SlackNameIssue[];
	suggestion: SuggestedNames | null;
};

/** One workspace member whose names need fixing, for the admin audit. */
export type SlackNameProblem = {
	slackId: string;
	realName: string;
	displayName: string;
	issues: SlackNameIssue[];
	suggestion: SuggestedNames | null;
	/** The scheduler user this Slack account belongs to, if they've ever signed in. */
	userId: UserId | null;
};

export type SlackNameReport = {
	status: SlackNameSyncStatus;
	attemptedAt: Date | null;
	checkedAt: Date | null;
	error: string | null;
	/** People in the workspace, deactivated accounts excluded. */
	memberCount: number;
	problems: SlackNameProblem[];
};

function slackNameReport(): SlackNameReport {
	const active = slackRoster.members.filter(m => !m.deleted);
	const problems: SlackNameProblem[] = [];
	for (const member of active) {
		const check = checkSlackNames(member);
		if (check.ok) continue;
		problems.push({
			slackId: member.id,
			realName: member.realName,
			displayName: member.displayName,
			issues: check.issues,
			suggestion: check.suggestion,
			userId: slackMappings.find(m => m.slackId === member.id)?.userId ?? null,
		});
	}
	problems.sort((a, b) => (a.displayName || a.realName).localeCompare(b.displayName || b.realName));
	return {
		status: slackRoster.status,
		attemptedAt: slackRoster.attemptedAt,
		checkedAt: slackRoster.checkedAt,
		error: slackRoster.error,
		memberCount: active.length,
		problems,
	};
}

/** Status of the Slack name checks, for the admin UI. */
export function slackNameSyncState(): Pick<SlackNameReport, "status" | "checkedAt" | "error"> {
	return { status: slackRoster.status, checkedAt: slackRoster.checkedAt, error: slackRoster.error };
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
	id: string;
	date: EventDate;
	endDate?: EventDate;
	slot?: TimeSlot; // Absent when the whole day is blacked out
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

/** General-access and personal-link administration, attributed to the admin who did it. */
type LogPersonalAccessEntry = LogCommon & {
	type: "generalAccessApprove" | "generalAccessRevoke" | "personalLinkReveal" | "personalLinkRotate";
	targetUserId: UserId;
	targetName: string;
};

/** An admin DM'd everyone whose Slack names need fixing. */
type LogSlackNamesEntry = LogCommon & {
	type: "slackNamesNudge";
	count: number;
};

type LogEntry =
	| LogReservationEntry
	| LogBlackoutEntry
	| LogSiteEventEntry
	| LogUserEntry
	| LogTeamAccessEntry
	| LogPersonalAccessEntry
	| LogSlackNamesEntry;

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
	/** The session's real Slack user id, once `getUser` has worked it out; null if Slack couldn't identify them. */
	private slackId: string | null = null;

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

		await this.restrictBlackout(reservation.date, reservation.slot);

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

	/**
	 * Black out the field for a single day, or for an inclusive range of days.
	 *
	 * Reservations that already exist inside the new blackout are left alone and returned to the
	 * caller, so an admin can decide what to do about them rather than having them silently
	 * cancelled.
	 */
	async addBlackout(blackout: AddBlackoutArgs) {
		await this.restrictToAdmin("Only admins can add blackouts");

		// Throws if the range runs backwards
		const { date, endDate, slot, reason } = normalizeBlackoutRange(blackout);

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
		const jobs: Promise<unknown>[] = [];

		const newBlackout: Blackout = {
			id: crypto.randomUUID(),
			date,
			endDate,
			slot,
			reason,
			created: ctx.timestamp,
			userId: ctx.userId,
		};

		const conflicts = reservations.filter(r => !r.abandoned && blackoutCoversSlot(newBlackout, r.date, r.slot));

		blackouts.push(newBlackout);

		jobs.push(
			log({
				...ctx,
				type: "blackoutAdd",
				id: newBlackout.id,
				date,
				endDate,
				slot,
				reason,
			}),
		);

		jobs.push(tellClientsAboutBlackoutChange(newBlackout));

		jobs.push(writeJsonFile(BLACKOUTS_FILE, blackouts));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));

		return { blackout: { ...newBlackout }, conflicts: conflicts.map(r => ({ ...r })) };
	}

	async removeBlackout({ id }: { id: string }) {
		await this.restrictToAdmin("Only admins can remove blackouts");

		const blackout = blackouts.find(b => b.id === id && !b.deleted);
		if (!blackout) {
			throw new Error("Blackout not found");
		}

		const release = await changeLock.acquire();
		const ctx = await this.getContext();
		const jobs: Promise<unknown>[] = [];

		blackout.deleted = ctx.timestamp; // Mark as deleted
		blackout.userId = ctx.userId; // Update the user ID to the current user

		jobs.push(
			log({
				...ctx,
				type: "blackoutRemove",
				id: blackout.id,
				date: blackout.date,
				endDate: blackout.endDate,
				slot: blackout.slot,
				reason: blackout.reason,
			}),
		);

		jobs.push(tellClientsAboutBlackoutChange(blackout));

		jobs.push(writeJsonFile(BLACKOUTS_FILE, blackouts));

		const done = Promise.all(jobs);
		await (ContinueOnError ? done.finally(release) : done.then(release));

		return { ...blackout };
	}

	/** Every blackout still in effect. Any signed-in user may read these; the calendar needs them. */
	async getBlackouts(): Promise<Blackout[]> {
		if (!(await this.user)) throw new PermissionError("Not authenticated");

		return activeBlackouts(blackouts).map(b => ({ ...b }));
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

		const sessionId = this.session.user.id;
		const email = this.session.user.email ?? "";

		const sessionName = this.session.user.name ?? undefined;

		// The session id is the Slack user id -- unless the session predates the
		// `jwt` callback in auth/config.ts, in which case it's a random UUID and
		// the real id has to be found by email. Null when Slack can't tell us,
		// which holds gate links (and nothing else) until they sign in again.
		const slackId = isSlackUserId(sessionId) ? sessionId : await resolveSlackIdByEmail(sessionId, email);
		this.slackId = slackId;

		// First check if we have a direct Slack ID mapping
		const existingMapping = slackId ? slackMappings.find(m => m.slackId === slackId) : undefined;
		if (existingMapping) {
			const user = users.find(u => u.id === existingMapping.userId);
			if (!user) {
				throw new Error("User mapping exists but user not found");
			}
			if (user.disabled) {
				throw new PermissionError("User disabled");
			}
			await syncUserFromSession(user, sessionName);
			await this.startNameCheck(user);
			return user;
		}

		// If no Slack ID mapping, check if we have a user with this email
		if (email) {
			const existingUser = users.find(u => u.email === email);
			if (existingUser) {
				if (existingUser.disabled) {
					throw new PermissionError("User disabled");
				}

				// Found existing user by email: remember their Slack id, when we have one
				if (slackId) {
					const release = await changeLock.acquire();
					slackMappings.push({ slackId, userId: existingUser.id });
					void writeJsonFile(SLACK_MAPPINGS_FILE, slackMappings)
						.catch(err => {
							console.error("Error saving Slack mapping:", err);
						})
						.finally(release);
				}

				await syncUserFromSession(existingUser, sessionName);
				await this.startNameCheck(existingUser);
				return existingUser;
			}
		}

		// Slack couldn't identify the session and no user has its email: fall
		// back to the mapping its id was stored under, if the start-up prune kept
		// it (it does when it's the only way to find the person).
		if (!slackId) {
			const legacy = slackMappings.find(m => m.slackId === sessionId);
			const user = legacy && users.find(u => u.id === legacy.userId);
			if (user) {
				if (user.disabled) {
					throw new PermissionError("User disabled");
				}
				await syncUserFromSession(user, sessionName);
				return user;
			}
		}

		// No existing user found, create new user entry
		const newUserId = crypto.randomUUID();
		const nameForUser = this.session.user.name ?? email ?? "Unknown";
		// Teams from the sign-in name until Slack's Web API supplies the real names.
		const parsedSlackName = parseSlackName(nameForUser);
		const sortedTeams = parsedSlackName ? [...parsedSlackName.teams].sort((a, b) => a - b) : [];
		const newUser: UserEntry = {
			id: newUserId,
			name: nameForUser,
			created: new Date(),
			updated: new Date(),
			teams: FirstUserIsAdmin && !users.length ? "admin" : sortedTeams,
			email,
			image: this.session.user.image ?? "",
		};

		const release = await changeLock.acquire();

		users.push(newUser);

		// Add Slack mapping -- only a real one; a session Slack couldn't identify has nothing to map
		if (slackId) slackMappings.push({ slackId, userId: newUserId });

		// Save both the updated users array and slack mappings
		void Promise.all(
			[users, slackMappings].map(a =>
				writeJsonFile(getFilePath(a), a).catch(err => console.error("Error saving user data:", err)),
			),
		).then(release);

		await this.startNameCheck(newUser);

		return newUser;
	}

	/**
	 * Read the person's Slack names (waiting briefly the first time, so their
	 * first page can already say what's wrong) and send any links they're due.
	 * Nothing to do when Slack couldn't identify them.
	 */
	private async startNameCheck(user: UserEntry): Promise<void> {
		if (!this.slackId) return;
		await awaitFirstNameCheck(user, this.slackId);
		fireLinkDms(user, this.slackId);
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

		// `isAdmin()` is async: without the await this condition was a truthy
		// Promise, so the filtering below never ran. Both callers are admin-gated
		// pages, so nothing leaked, but the check was doing nothing.
		if (!(await this.isAdmin())) {
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

	/**
	 * Slack user ID (e.g. "U01ABCDEF") of the current session, for DM
	 * targeting. Null when Slack couldn't identify the person -- a session from
	 * before the `jwt` callback whose email matches no Slack account.
	 */
	async getSlackUserId(): Promise<string | null> {
		await this.user;
		return this.slackId;
	}

	/**
	 * The current person's own Slack names and whether they follow the rules.
	 * The only thing the rules gate is receiving gate links; the calendar shows
	 * this so people know what to fix, and that booking is unaffected.
	 */
	async getMySlackNames(): Promise<MySlackNames> {
		const user = await this.user;
		const check = slackNameCheckFor(user);
		return {
			identified: this.slackId !== null,
			realName: user.name,
			displayName: user.displayName ?? null,
			syncedAt: user.slackNamesSyncedAt ?? null,
			ok: check.ok,
			issues: check.issues,
			suggestion: check.suggestion,
		};
	}

	/**
	 * Re-read the person's Slack names now, skipping the background refresh's
	 * throttle, and send any links they're now due -- the "Check again" button
	 * after they've edited their Slack profile.
	 */
	async recheckMySlackNames(): Promise<MySlackNames> {
		const user = await this.user;
		if (this.slackId) {
			slackNamesRefreshedAt.delete(user.id);
			await refreshSlackNames(user, this.slackId);
			await ensureLinksForUser(user, this.slackId);
		}
		return this.getMySlackNames();
	}

	/** When each person last reported browser errors, for the per-minute cap. */
	private static readonly clientErrorTimes = new Map<string, number[]>();

	/**
	 * Record an error the browser hit, with who and where, for review later.
	 * Capped per person per minute, so a page stuck in a loop can't fill the disk.
	 */
	async reportClientError(input: {
		kind: string;
		message: string;
		detail?: string;
		page?: string;
	}): Promise<{ recorded: boolean }> {
		const userId = await this.userIdForLog();
		const now = Date.now();
		const recent = (Context.clientErrorTimes.get(userId) ?? []).filter(t => now - t < 60_000);
		if (recent.length >= CLIENT_ERROR_REPORTS_PER_MINUTE) return { recorded: false };
		recent.push(now);
		Context.clientErrorTimes.set(userId, recent);
		await recordError({ source: "client", ...input, userId, userAgent: this.userAgent, ip: this.ip });
		return { recorded: true };
	}

	/** File an error that happened while serving this person, with who and where. */
	async recordServerError(kind: string, message: string, detail?: unknown): Promise<void> {
		await recordError({
			source: "server",
			kind,
			message,
			detail,
			userId: await this.userIdForLog(),
			userAgent: this.userAgent,
			ip: this.ip,
		});
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
	async rotateTeamAccessLink(team: TeamFull): Promise<{
		team: TeamFull;
		notified: number;
		failed: number;
		/** Members not sent the new link because their Slack names need fixing. */
		held: number;
		slackConfigured: boolean;
	}> {
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

		const failed = outcomes.filter(o => !o.sent && o.reason !== "slack_not_configured");
		if (failed.length > 0) {
			console.warn(
				`Team ${team} link rotation: ${failed.length}/${outcomes.length} DM(s) failed:`,
				failed.map(f => `${f.userId}/${f.slackUserId}: ${f.error ?? f.reason}`),
			);
		}

		return {
			team: entry.team,
			notified: outcomes.filter(o => o.sent).length,
			failed: failed.length,
			held: new Set(recipients.filter(r => !r.withLink).map(r => r.user.id)).size,
			slackConfigured: isSlackConfigured(),
		};
	}

	/**
	 * Admin-only: personal-link status for every user, keyed by user ID. Like
	 * the team listing, it never includes the token itself.
	 */
	async listPersonalAccess(): Promise<
		Record<
			UserId,
			{
				status: PersonalAccessStatus;
				created: Date | null;
				rotated: Date | null;
				/** Empty when the person's Slack names are fine; their gate links wait on this. */
				nameIssues: SlackNameIssue[];
			}
		>
	> {
		await this.assertAdmin("Only admins can view personal access");
		await initialized();

		const out: Awaited<ReturnType<Context["listPersonalAccess"]>> = {};
		for (const user of users) {
			const entry = findPersonalAccess(user.id);
			const names = slackNameCheckFor(user);
			const status: PersonalAccessStatus = user.disabled
				? "disabled"
				: !user.generalAccessApproved
					? "not_approved"
					: !names.ok
						? "invalid_name"
						: entry
							? "active"
							: "not_issued";
			out[user.id] = {
				status,
				created: entry?.created ?? null,
				rotated: entry?.rotated ?? null,
				nameIssues: names.issues,
			};
		}
		return out;
	}

	/** Look up a user an admin action targets, refusing ones that can't hold a link. */
	private eligibleTarget(userId: UserId): UserEntry {
		const target = users.find(u => u.id === userId);
		if (!target) throw new Error("User not found");
		if (!isPersonalAccessEligible(target)) {
			throw new Error(
				target.disabled
					? "This account is disabled"
					: !target.generalAccessApproved
						? "This account isn't approved for general gate access"
						: "This person's Slack names need fixing, so their link is on hold",
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
	async rotatePersonalAccessLink(userId: UserId): Promise<{ userId: UserId } & LinkDelivery> {
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

		return { userId: target.id, ...(await deliverPersonalLink(target, entry.token, "rotated")) };
	}

	/**
	 * Admin-only: approve someone for general gate access, or revoke it.
	 *
	 * Approving issues their personal link and DMs it straight away, so they
	 * don't have to sign in again to get it. If their Slack name doesn't parse
	 * the approval is still recorded, but no link is issued until it's fixed.
	 *
	 * Revoking deletes the link outright — it may have spread — so approving
	 * again later issues a fresh token rather than reviving the old one.
	 */
	async setGeneralAccessApproved(
		userId: UserId,
		approved: boolean,
	): Promise<{ userId: UserId; approved: boolean; linkIssued: boolean } & LinkDelivery> {
		await this.assertAdmin("Only admins can approve general gate access");
		await initialized();

		const target = users.find(u => u.id === userId);
		if (!target) throw new Error("User not found");
		if (approved && target.disabled) throw new Error("This account is disabled");

		if (Boolean(target.generalAccessApproved) !== approved) {
			const release = await changeLock.acquire();
			try {
				target.generalAccessApproved = approved ? true : undefined;
				target.updated = new Date();
				await writeJsonFile(USERS_FILE, users);
			} finally {
				release();
			}
		}

		const ctx = await this.getContext();
		await log({
			...ctx,
			type: approved ? "generalAccessApprove" : "generalAccessRevoke",
			targetUserId: target.id,
			targetName: target.displayName ?? target.name,
		});

		const nothingSent: LinkDelivery = { notified: 0, failed: 0, skipped: null };
		if (!approved) {
			await removePersonalAccess(target.id);
			return { userId: target.id, approved, linkIssued: false, ...nothingSent };
		}
		if (!isPersonalAccessEligible(target)) {
			// Most likely their Slack names; tell them, once, what to fix.
			for (const slackId of slackIdsFor(target.id)) await nudgeAboutNames(target, slackId, "links_held");
			return { userId: target.id, approved, linkIssued: false, ...nothingSent };
		}

		const entry = await ensureAccess(personalStore(target.id));
		const delivery = target.gateLinkSentTokens?.includes(entry.token)
			? nothingSent
			: await deliverPersonalLink(target, entry.token, "approved");
		return { userId: target.id, approved, linkIssued: true, ...delivery };
	}

	/**
	 * Admin-only: everyone in the Slack workspace whose names need fixing, from
	 * the last workspace sync, including people who've never signed in here.
	 */
	async getSlackNameReport(): Promise<SlackNameReport> {
		await this.assertAdmin("Only admins can audit Slack names");
		await initialized();
		return slackNameReport();
	}

	/** Admin-only: re-read the workspace's names now, then report. */
	async checkSlackNamesNow(): Promise<SlackNameReport> {
		await this.assertAdmin("Only admins can audit Slack names");
		await syncSlackNames();
		return slackNameReport();
	}

	/**
	 * Admin-only: DM everyone in the last report what to fix. With `dryRun`,
	 * only reports who would be DM'd. Per-person failures are reported, not
	 * thrown. People who use the scheduler are marked as told, so signing in
	 * doesn't DM them the same thing again.
	 */
	async nudgeSlackNameProblems(dryRun: boolean): Promise<{
		dryRun: boolean;
		total: number;
		succeeded: number;
		failed: number;
		outcomes: Array<{ slackId: string; name: string; ok: boolean; error?: string }>;
	}> {
		await this.assertAdmin("Only admins can nudge people about their names");
		await initialized();
		if (slackRoster.status !== "ok") {
			throw new Error("Slack names haven't been read successfully yet, so there's no one to DM");
		}
		if (!dryRun && !isSlackConfigured()) throw new Error("SLACK_BOT_TOKEN isn't configured");

		const { problems } = slackNameReport();
		const outcomes: Array<{ slackId: string; name: string; ok: boolean; error?: string }> = [];
		for (const problem of problems) {
			const name = problem.displayName || problem.realName || problem.slackId;
			if (dryRun) {
				outcomes.push({ slackId: problem.slackId, name, ok: true });
				continue;
			}
			const names = { realName: problem.realName, displayName: problem.displayName };
			const outcome = await sendNameFixDm(problem.slackId, names, checkSlackNames(names), "admin_nudge");
			if (!outcome.sent) {
				outcomes.push({ slackId: problem.slackId, name, ok: false, error: outcome.error ?? outcome.reason });
				continue;
			}
			outcomes.push({ slackId: problem.slackId, name, ok: true });

			// Only once the stored names match what we just DM'd about.
			const user = problem.userId ? users.find(u => u.id === problem.userId) : undefined;
			if (
				user?.slackNamesSyncedAt &&
				user.name === problem.realName &&
				(user.displayName ?? "") === problem.displayName
			) {
				user.slackNameNudgeSentFor = nameNudgeKey(user);
				await saveUsers("admin name nudge");
			}
		}

		const succeeded = outcomes.filter(o => o.ok).length;
		if (!dryRun) {
			const ctx = await this.getContext();
			await log({ ...ctx, type: "slackNamesNudge", count: succeeded });
		}
		return { dryRun, total: outcomes.length, succeeded, failed: outcomes.length - succeeded, outcomes };
	}

	/**
	 * Refuse an action, and say so in the journal.
	 *
	 * Refusals used to be invisible server-side: a user reporting "I can't book"
	 * left nothing in the log to grep for, so every report started with
	 * archaeology. Every refusal on the reservation path goes through here.
	 */
	private async refuse(message: string, detail: Record<string, unknown>): Promise<never> {
		const userId = await this.userIdForLog();
		console.warn(`🚫 refused: ${message}`, { userId, ...detail });
		void recordError({
			source: "server",
			kind: "refused",
			message,
			detail,
			userId,
			userAgent: this.userAgent,
			ip: this.ip,
		});
		throw new PermissionError(message);
	}

	/** The current user's id, or "unknown" -- never throws, so it's safe inside a log line. */
	private async userIdForLog(): Promise<UserId | "unknown"> {
		return this.user.then(
			u => u.id,
			() => "unknown" as const,
		);
	}

	private async restrictToTeam(team: Team | TeamFull, message: string) {
		if (typeof team === "string") team = Number.parseInt(team, 10);

		const permissions = await this.getEditPermissions();
		if (permissions === "admin") return;
		if (permissions.includes(team)) return;

		// Logged but allowed while EnforceTeamMembership is off, so the journal
		// shows who this rule would have blocked before it's switched on.
		if (!EnforceTeamMembership) {
			console.warn(`⚠️ allowed despite team mismatch: ${message}`, {
				userId: await this.userIdForLog(),
				team,
				teams: permissions,
			});
			return;
		}

		await this.refuse(message, { team, teams: permissions });
	}

	/**
	 * Refuse a reservation in a slot an admin has blacked out.
	 *
	 * Admins are exempt, as they are for the advance-reservation window: they are the ones who set
	 * the blackout, so they can still book over one without tearing it down first.
	 */
	private async restrictBlackout(date: EventDate, slot: TimeSlot) {
		if (await this.isAdmin()) return;

		const blackout = findBlackoutForSlot(blackouts, date, slot);
		if (!blackout) return;

		await this.refuse(
			blackout.reason
				? `The field is blacked out for this time: ${blackout.reason}`
				: "The field is blacked out for this time",
			{ date, slot, blackoutId: blackout.id },
		);
	}

	/**
	 * Refuse a reservation outside the bookable window: today through today plus
	 * AdvancedReservationDays, on the field's calendar. Admins are exempt.
	 *
	 * Both ends are compared as "YYYY-MM-DD" strings in TIME_ZONE. Mixing `Date`
	 * objects here is what broke booking: `new Date("2026-09-17")` is midnight
	 * UTC while `setHours(0, 0, 0, 0)` is midnight locally, so in Pacific today
	 * always looked like the past and no non-admin could book the evening they
	 * were standing in. Comparing against `now + 7 days` had a second flaw --
	 * the far edge drifted with the time of day, so the seventh day was bookable
	 * in the morning and refused in the evening.
	 */
	private async restrictTimeframe(date: EventDate) {
		if (await this.isAdmin()) return; // Admins can reserve any date

		const today = fieldToday();
		if (date < today) await this.refuse("Cannot reserve a date in the past", { date, today });

		const lastBookable = addFieldDays(today, AdvancedReservationDays);
		if (lastBookable && date > lastBookable)
			await this.refuse(`Cannot reserve a date more than ${AdvancedReservationDays} days in advance`, {
				date,
				lastBookable,
			});
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
// What went wrong for people -- server refusals, unexpected failures, and what
// browsers report -- one JSON object per line, for review later.
const ERRORS_FILE = join(DATA_DIR, YEAR, "errors.txt");

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

/** One thing that went wrong for someone. See `recordError`. */
export type ErrorRecord = {
	timestamp: Date;
	/** Where it was caught: on the server, or reported by a browser. */
	source: "server" | "client";
	/** Short category: "refused", "trpc", "render", "unhandled", "network", ... */
	kind: string;
	message: string;
	detail?: unknown;
	userId?: UserId | "unknown";
	/** The page the person was on (browser reports). */
	page?: string;
	userAgent?: string;
	ip?: string;
};

/** Per-person cap on browser error reports, so a runaway loop can't fill the disk. */
const CLIENT_ERROR_REPORTS_PER_MINUTE = 30;

/**
 * Append what went wrong to the season's `errors.txt`, one JSON object per
 * line, so the errors people hit can be reviewed later without hunting through
 * the journal. Never throws; a failure to record is itself logged.
 */
export async function recordError(entry: Omit<ErrorRecord, "timestamp">): Promise<void> {
	if (DisableWrites) return;
	try {
		const line = JSON.stringify({ timestamp: new Date(), ...entry });
		await appendFile(ERRORS_FILE, `${line}\n`, "utf-8");
	} catch (err) {
		console.error("Error appending to errors file:", err);
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

		// Set when loading rewrote any record (a migration, or a scrubbed dead field), so the
		// change is persisted instead of being redone (with different ids) on every boot
		let migrated = false;

		array.push(
			...data.filter(item => {
				// Filter out expired keys
				if (array === users) {
					if (typeof item !== "object" || item === null) return false;
					item.created = new Date(item.created);
					item.updated = new Date(item.updated);
					if (item.slackNamesSyncedAt) item.slackNamesSyncedAt = new Date(item.slackNamesSyncedAt);
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
						migrated = true;
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
						migrated = true;
					}
				}

				if (array === blackouts) {
					if (typeof item !== "object" || item === null) return false;
					if (item.created) item.created = new Date(item.created);
					if (item.deleted) item.deleted = new Date(item.deleted);
					// Blackouts written before they gained ranges were keyed by date+slot alone. Give
					// them a stable id so they can be removed like any other.
					if (!item.id) {
						item.id = crypto.randomUUID();
						migrated = true;
					}
				}

				return true;
			}),
		);

		if (migrated) {
			await writeJsonFile(filePath, array as JsonData);
			console.log(`🔧 [${MODULE_INSTANCE_ID}] Migrated ${arrayName} on load - PID: ${process.pid}`);
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

/**
 * A personal link may only exist for someone approved for general gate
 * access. Links written before approval was required, or whose owner's user
 * record has since expired, are deleted here. Otherwise approving that person
 * later would quietly revive an old token instead of issuing a fresh one.
 *
 * Runs once at startup, while initialization holds `changeLock`.
 */
async function prunePersonalLinksWithoutApproval() {
	const approved = new Set(users.filter(u => u.generalAccessApproved).map(u => u.id));
	const kept = personalAccess.filter(p => approved.has(p.userId));
	const removed = personalAccess.length - kept.length;
	if (removed === 0) return;

	for (const p of personalAccess) {
		if (!approved.has(p.userId)) accessByToken.delete(p.token);
	}
	personalAccess.splice(0, personalAccess.length, ...kept);
	console.warn(
		`⚠️ [${MODULE_INSTANCE_ID}] Removed ${removed} personal gate link(s) whose owner isn't approved for general gate access`,
	);
	await writeJsonFile(PERSONAL_ACCESS_FILE, personalAccess);
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

	// Needs both users and personal links loaded, and still holds the lock.
	await prunePersonalLinksWithoutApproval();
	await pruneNonSlackMappings();

	globalThis.__backendInitialized = true;
	done();

	startSlackNameSync();
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

	// Resolve the live user so disabling or a broken Slack name takes effect
	// immediately. A link whose user has since expired grants nothing.
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
