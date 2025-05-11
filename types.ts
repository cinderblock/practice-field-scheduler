export type AddReservationArgs = Pick<Reservation, "date" | "slot" | "team" | "notes" | "priority">;
export type RemoveReservationArgs = Pick<Reservation, "date" | "slot" | "team"> & { reason?: string };

export type Reservation = {
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
export type TimeSlot = 0 | 1 | 2; // 3 time slots per day
export const TIME_SLOTS = 3; // Number of time slots per day
export type TeamFull = string; // Team number (with optional postfix)
export type Team = number; // Team number
export type UserKey = string;
export type UserId = number; // Unique user ID

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
