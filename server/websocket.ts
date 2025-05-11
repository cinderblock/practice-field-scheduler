/**
 * Websocket interface for clients to communicate with the server.
 *
 * This is used to send updates to the clients when a reservation is made or changed and to receive commands from the clients.
 * This handles all the websocket connections, messages, validation and sanitization, and sending messages to connected clients.
 */

import { Server } from "node:http";
import { WebSocket, WebSocketServer, RawData } from "ws";
import { Context, PermissionError } from "./backend.js";
import { Blackout, SiteEvent, Team } from "../types.js";
import { TIME_SLOTS } from "../types.js";
import { Reservation } from "../types.js";
import { JsonData } from "./util/JsonData.js";
import { exit } from "./util/exit.js";

const wsServer = new WebSocketServer({ noServer: true });

type ClientEvent =
  | AddReservationEvent
  | RemoveReservationEvent
  | AddSiteEventEvent
  | RemoveSiteEventEvent
  | AddBlackoutEvent
  | RemoveBlackoutEvent
  | AddUserEvent
  | AddTeamEvent;

type AddReservationEvent = {
  type: "addReservation";
} & Pick<Reservation, "date" | "slot" | "priority" | "team" | "notes">;

type RemoveReservationEvent = {
  type: "removeReservation";
} & Pick<Reservation, "date" | "slot" | "team">;

type AddSiteEventEvent = {
  type: "addSiteEvent";
} & Pick<SiteEvent, "date" | "notes">;

type RemoveSiteEventEvent = {
  type: "removeSiteEvent";
} & Pick<SiteEvent, "date">;

type AddBlackoutEvent = {
  type: "addBlackout";
} & Pick<Blackout, "date" | "slot" | "reason">;

type RemoveBlackoutEvent = {
  type: "removeBlackout";
} & Pick<Blackout, "date" | "slot">;

type AddUserEvent = {
  type: "addUser";
  name: string;
};

type AddTeamEvent = {
  type: "addTeam";
  team: Team;
};

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 *
 * Validates the data type and value of the given data.
 *
 * Throws an error if the data is not of the expected type or does not pass the validation function.
 *
 * @param data
 * @param type
 */
function validate(data: unknown, type: "string", val?: (v: string) => boolean): void;
function validate(data: unknown, type: "number", val?: (v: number) => boolean): void;
function validate(data: unknown, type: "boolean"): void;
function validate(data: unknown, type: "object", val?: (v: object) => boolean): void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validate(data: unknown, type: "string" | "number" | "boolean" | "object", val?: (v: any) => boolean): void {
  if (typeof data !== type) throw new ValidationError(`Expected ${type}, got ${typeof data}`);
  if (!val) return;
  if (!val(data)) throw new ValidationError(`Validation failed for ${type}`);
}

function isCurrentDate(date: string): boolean {
  const groups = date.match(/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/)?.groups;

  if (!groups) return false;

  const d = new Date(date);
  const { year, month, day } = groups;

  // Only current year is allowed
  if (year !== new Date().getFullYear() + "") return false;
  if (d.getFullYear() !== parseInt(year)) return false;
  if (d.getMonth() + 1 !== parseInt(month)) return false;
  if (d.getDate() !== parseInt(day)) return false;

  // Past dates / dates too far in the future are checked in the backend

  return true;
}

function isValidTeam(team: string): boolean {
  // Team number (1-99999) with optional postfix of any length (e.g. "100", "114Backup", "1868 Guest: 1234")
  return /^[1-9]\d{0,4}(?:\D|$)/.test(team);
}

// Prevents the use of any object with keys that are not in the list
function isObjectWithKeysExclusive(data: unknown, keys: string[]): boolean {
  if (!data) return false;
  if (typeof data !== "object") return false;
  for (const key in data) if (!keys.includes(key)) return false;
  return true;
}

function isObjectWithTypeAndKeys(data: unknown, type: string, keys: string[]): boolean {
  if (!isObjectWithKeysExclusive(data, ["type", ...keys])) return false;
  if ((data as { type: string }).type !== type) return false;
  return true;
}

function isAddReservationEvent(data: unknown, context?: Context | undefined): data is AddReservationEvent {
  if (!isObjectWithTypeAndKeys(data, "addReservation", ["date", "slot", "priority", "team", "notes"])) return false;

  const event = data as AddReservationEvent;
  const { date, slot, priority, team, notes } = event;

  validate(date, "string", isCurrentDate);
  validate(slot, "number", v => v >= 0 && v < TIME_SLOTS);
  validate(team, "string", isValidTeam);
  validate(notes, "string");
  if (priority !== undefined) validate(priority, "boolean");

  context?.addReservation(event);

  return true;
}

function isRemoveReservationEvent(data: unknown, context?: Context | undefined): data is RemoveReservationEvent {
  if (!isObjectWithTypeAndKeys(data, "removeReservation", ["date", "slot", "team"])) return false;

  const event = data as RemoveReservationEvent;
  const { date, slot, team } = event;

  validate(date, "string", isCurrentDate);
  validate(slot, "number", v => v >= 0 && v < TIME_SLOTS);
  validate(team, "string", isValidTeam);

  context?.removeReservation(event);

  return true;
}

function isAddSiteEventEvent(data: unknown, context?: Context | undefined): data is AddSiteEventEvent {
  if (!isObjectWithTypeAndKeys(data, "addSiteEvent", ["date", "notes"])) return false;

  const event = data as AddSiteEventEvent;
  const { date, notes } = event;

  validate(date, "string", isCurrentDate);
  validate(notes, "string");

  context?.addSiteEvent(event);

  return true;
}

function isRemoveSiteEventEvent(data: unknown, context?: Context | undefined): data is RemoveSiteEventEvent {
  if (!isObjectWithTypeAndKeys(data, "removeSiteEvent", ["date"])) return false;

  const event = data as RemoveSiteEventEvent;
  const { date } = event;

  validate(date, "string", isCurrentDate);

  context?.removeSiteEvent(event);

  return true;
}

function isAddBlackoutEvent(data: unknown, context?: Context | undefined): data is AddBlackoutEvent {
  if (!isObjectWithTypeAndKeys(data, "addBlackout", ["date", "slot", "reason"])) return false;

  const event = data as AddBlackoutEvent;
  const { date, slot, reason } = event;

  validate(date, "string", isCurrentDate);
  validate(slot, "number", v => v >= 0 && v < TIME_SLOTS);
  validate(reason, "string", v => v.trim().length > 0);

  context?.addBlackout(event);

  return true;
}

function isRemoveBlackoutEvent(data: unknown, context?: Context | undefined): data is RemoveBlackoutEvent {
  if (!isObjectWithTypeAndKeys(data, "removeBlackout", ["date", "slot"])) return false;

  const event = data as RemoveBlackoutEvent;
  const { date, slot } = event;

  validate(date, "string", isCurrentDate);
  validate(slot, "number", v => v >= 0 && v < TIME_SLOTS);

  context?.removeBlackout(event);

  return true;
}

function isAddUserEvent(data: unknown, context?: Context | undefined): data is AddUserEvent {
  if (!isObjectWithTypeAndKeys(data, "addUser", ["name"])) return false;

  const event = data as AddUserEvent;
  const { name } = event;

  validate(name, "string", /^[A-Za-z]{2}.*[A-Za-z]$/.test);

  context?.registerKey(event);

  return true;
}

function isAddTeamEvent(data: unknown, context?: Context | undefined): data is AddTeamEvent {
  if (!isObjectWithTypeAndKeys(data, "addTeam", ["team"])) return false;

  const event = data as AddTeamEvent;
  const { team } = event;

  validate(team, "string", isValidTeam);

  context?.addTeam(event);

  return true;
}

function isClientEvent(data: unknown, context?: Context | undefined): data is ClientEvent {
  if (isAddReservationEvent(data, context)) return true;
  if (isRemoveReservationEvent(data, context)) return true;
  if (isAddSiteEventEvent(data, context)) return true;
  if (isRemoveSiteEventEvent(data, context)) return true;
  if (isAddBlackoutEvent(data, context)) return true;
  if (isRemoveBlackoutEvent(data, context)) return true;
  if (isAddUserEvent(data, context)) return true;
  if (isAddTeamEvent(data, context)) return true;
  return false;
}

export function setupWebSocketServer(httpServer: Server) {
  httpServer.on("upgrade", (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head, ws => {
      wsServer.emit("connection", ws, req);
    });
  });
}

function handleWsMessage(message: RawData, context: Context | undefined, handleError?: (e: Error) => void) {
  try {
    const data = JSON.parse(message.toString());

    if (isClientEvent(data, context)) return;

    console.error(`Unknown data: ${data}`);
  } catch (e) {
    if (e instanceof Error) {
      console.error("Error in client request:", e.message);
      handleError?.(e);
      return;
    }
    console.error("WTF!!!", e);
    exit(1);
  }
}

const connectedClients = {} as Record<Team | "admin", WebSocket[]>;
const connectedUsers = {} as Record<string, WebSocket[]>;

wsServer.on("connection", (ws, req) => {
  const {
    headers: { key, "user-agent": userAgent },
    socket: { remoteAddress: ip },
  } = req;

  if (!ip) {
    console.error("No IP address detected???");
    ws.close(4000, "No IP address detected???");
    return;
  }

  if (typeof key !== "string") {
    console.error(`No key provided in headers from ${ip}`);
    ws.close(4000, "No key provided in headers");
    return;
  }

  if (!userAgent) {
    console.error(`No user agent provided in headers from ${ip}`);
    ws.close(4000, "No user agent provided in headers");
    return;
  }

  const context = new Context(key, userAgent, ip);

  ws.on("message", message =>
    handleWsMessage(message, context, e => {
      let type = "UnknownError";
      if (e instanceof PermissionError) type = "PermissionError";
      if (e instanceof ValidationError) type = "ValidationError";
      if (e instanceof Error) type = "Error";

      ws.send(JSON.stringify({ error: e.message, type }));
    }),
  );

  try {
    let teams: (Team | "admin")[] | "admin" = context.getTeams();
    if (teams === "admin") teams = [teams];
    const name = context.getName();

    ws.on("close", () => {
      for (const team of teams) {
        const index = connectedClients[team].indexOf(ws);
        if (index !== -1) connectedClients[team].splice(index, 1);
      }
      const index = connectedUsers[name].indexOf(ws);
      if (index !== -1) connectedUsers[name].splice(index, 1);
    });

    for (const team of teams) {
      if (!connectedClients[team]) connectedClients[team] = [];
      connectedClients[team].push(ws);
    }
    if (!connectedUsers[name]) connectedUsers[name] = [];
    connectedUsers[name].push(ws);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // Not associated with a team
  }
});

export function sendToTeam(team: Team | "admin", message: string) {
  if (!connectedClients[team]) return;
  connectedClients[team].forEach(client => {
    if (client.readyState !== client.OPEN) return;
    client.send(message, error => {
      if (error) console.error("Error sending message:", error);
    });
  });
}

export function sendToUser(user: string, message: string) {
  if (!connectedUsers[user]) return;
  connectedUsers[user].forEach(client => {
    if (client.readyState !== client.OPEN) return;
    client.send(message, error => {
      if (error) console.error("Error sending message:", error);
    });
  });
}

async function broadcastMessage(message: JsonData) {
  if (typeof message !== "string") {
    message = JSON.stringify(message);
  }

  await Promise.all(
    [...wsServer.clients].map(async client => {
      if (client.readyState !== client.OPEN) return;
      await new Promise<void>((resolve, reject) =>
        client.send(message, error => {
          if (error) {
            console.error("Error sending message:", error);
            reject(error);
          } else {
            resolve();
          }
        }),
      );
    }),
  );
}

export async function tellClientsAboutReservationChange(reservation: Reservation) {
  await broadcastMessage({ reservation });
}

export async function tellClientsAboutBlackoutChange(blackout: Blackout) {
  await broadcastMessage({ blackout });
}

export async function tellClientsAboutSiteEvent(siteEvent: SiteEvent) {
  await broadcastMessage({ siteEvent });
}
