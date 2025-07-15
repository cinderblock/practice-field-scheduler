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
	name: string;
	created: Date;
	updated: Date;
	disabled?: boolean;
	teams: Team[] | "admin";
	email: string;
	image: string;
};

export type WeatherData = {
	date: EventDate;
	hourlyTemperatures: number[]; // Celsius temperatures for each hour (0-23)
	weatherCodes: number[]; // WMO weather codes for each hour
	updated: Date; // When this data was last fetched
};

export type WeatherForecast = {
	location: string;
	latitude: number;
	longitude: number;
	data: WeatherData[];
	lastUpdated: Date;
};

export type TimeSlotWeather = {
	startTemp: number; // Celsius
	middleTemp: number; // Celsius
	endTemp: number; // Celsius
	weatherCode: number; // Most common weather code in the time slot
};
