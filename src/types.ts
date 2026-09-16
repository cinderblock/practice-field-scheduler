export type AddReservationArgs = Pick<Reservation, "date" | "slot" | "team" | "notes" | "priority">;

export type RemoveReservationArgs = {
	id: string;
	reason?: string;
};

export type Reservation = {
	id: string;
	date: EventDate;
	slot: TimeSlot;
	created: Date;
	userId: UserId; // ID of the user who last modified the reservation
	priority: boolean; // True if the team requested priority on this reservation
	abandoned?: Date;
	team: TeamFull;
	notes?: string;
};
/////// Public-ish Interfaces //////

export type EventDate = string; // YYYY-MM-DD format
export type UserId = string;
export type Team = number;
export type TeamFull = Team | string;

export type TimeSlot = string; // HH:mm format

export type Blackout = {
	date: EventDate;
	slot: TimeSlot;
	created: Date;
	userId: UserId; // ID of the user who last modified the blackout
	deleted?: Date; // Date when the blackout was removed
	reason?: string;
};

export type SiteEvent = {
	date: EventDate;
	created: Date;
	userId: UserId; // ID of the user who last modified the event
	deleted?: Date; // Date when the event was removed
	notes?: string;
};

export type UserEntry = {
	id: UserId;
	name: string; // Full name (real_name from Slack)
	displayName?: string; // Display name (display_name from Slack) - optional for backward compatibility
	created: Date;
	updated: Date;
	disabled?: boolean;
	teams: Team[] | "admin";
	email: string;
	image: string;
	// Access tokens (team and personal) we've already DM'd this user. Lets
	// rotation self-heal: if a current token isn't in here, the next login DMs
	// the new link.
	gateLinkSentTokens?: string[];
	// Granted by an admin ("Approve general gate access"). Only approved people
	// hold a personal gate link; nobody has one by default, so shared or
	// unverified accounts simply never get approved.
	generalAccessApproved?: boolean;
};

/**
 * Per-team access token for tool integrations (currently just the gate).
 *
 * One link per team, shared among its members: anyone holding the URL can
 * use the tool during that team's reservation windows. Rotated on request
 * (team or admin); stored per season, so a new year starts with fresh links.
 */
export type TeamAccess = {
	team: TeamFull;
	/** Opaque URL-safe token; goes in `${GATE_BASE_URL}/g/<token>`. */
	token: string;
	created: Date;
	/** When the token was last rotated (absent if never). */
	rotated?: Date;
	/** Admin who performed the last rotation (absent for the initial issue). */
	rotatedBy?: UserId;
};

/**
 * Per-person access token. Unlike a team link it isn't tied to reservations:
 * it works any day within site hours (see `src/server/access.ts`), so it is
 * issued only to approved members and must not be shared.
 */
export type PersonalAccess = {
	userId: UserId;
	/** Opaque URL-safe token; goes in `${GATE_BASE_URL}/g/<token>`. */
	token: string;
	created: Date;
	/** When the token was last rotated (absent if never). */
	rotated?: Date;
	/** Admin who performed the last rotation (absent for the initial issue). */
	rotatedBy?: UserId;
};

/**
 * Where a person stands with general gate access, as shown to admins:
 * - `active`: approved, and their personal link exists
 * - `not_issued`: approved, link not created yet (issued on approval or sign-in)
 * - `not_approved`: no general gate access (the default)
 * - `invalid_name`: approved, but their Slack name doesn't parse, so the link is inactive
 * - `disabled`: the account is disabled
 */
export type PersonalAccessStatus = "active" | "not_issued" | "not_approved" | "invalid_name" | "disabled";

export type Holiday = {
	id: string;
	name: string;
	date: EventDate;
	icon: string; // Emoji or icon identifier
	url?: string; // Optional URL for more info
	created?: Date; // Optional for system holidays
	userId?: UserId; // Optional for system holidays
	deleted?: Date;
};
