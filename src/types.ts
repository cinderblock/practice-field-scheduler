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

/**
 * A period during which the field is unavailable.
 *
 * A blackout covers the inclusive date range `date`..`endDate`. `endDate` is omitted for a
 * single day. `slot` restricts the blackout to one time slot on each of those days; when it is
 * omitted the whole day is blacked out.
 */
export type Blackout = {
	id: string;
	date: EventDate; // First day of the blackout, inclusive
	endDate?: EventDate; // Last day of the blackout, inclusive. Omitted for a single day.
	slot?: TimeSlot; // Omitted to black out the entire day
	created: Date;
	userId: UserId; // ID of the user who last modified the blackout
	deleted?: Date; // Date when the blackout was removed
	reason?: string;
};

export type AddBlackoutArgs = Pick<Blackout, "date" | "endDate" | "slot" | "reason">;

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
	// When `name` and `displayName` were last taken from Slack's Web API.
	// Unset means they've never been verified there (sign-in alone can't see
	// the display name), so gate links are held.
	slackNamesSyncedAt?: Date;
	// The (full name, display name) pair we DM'd this person about fixing. Set
	// at all means they've been told: the scheduler DMs about names once per
	// person, for now, whatever they change them to afterwards.
	slackNameNudgeSentFor?: string;
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

/** One point of the hourly forecast. Values are null where the provider has no data. */
export type WeatherSample = {
	time: number; // Epoch milliseconds
	temperature: number | null; // Celsius
	precipitationProbability: number | null; // 0-100, over the hour before `time`
	weatherCode: number | null; // WMO weather interpretation code
	isDay: boolean | null; // Whether it's daylight at `time`
};

export type WeatherForecast = {
	/** Resolved place, for display. Coordinates when the location was configured as coordinates. */
	location: string;
	updated: Date; // When the forecast was fetched
	/** Hourly samples in chronological order, limited to the hours around reservation time */
	samples: WeatherSample[];
};

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
