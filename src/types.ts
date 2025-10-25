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
