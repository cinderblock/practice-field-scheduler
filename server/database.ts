// Data
// - Site Events
//   - date
//   - notes
// - Blackouts
//   - date & slot
//   - eventId (if site event)
// - reservations
//   - date & slot
//   - created
//   - team
//   - notes
// - logs - log changes to reservations
//   - timestamp
//   - IP
//   - user agent
//   - user (if logged in)
//   - type - created, updated, deleted
//   - date & slot
//   - team
//   - notes
//     - old notes (if updated)
//     - deletion reason (if deleted)
// - keys
//   - key
//   - created
//   - user name
//   - teams - teams that this user can change

import fs from "fs/promises";
import { resolve, join } from "path";

/////// Public Interfaces //////

type Reservation = {
  date: string;
  slot: string;
  team: string;
  notes?: string;
};

type Blackout = {
  date: string;
  slot: string;
  reason?: string;
};

type SiteEvent = {
  date: string;
  notes?: string;
};

type LogEntry = {
  timestamp: string;
  ip: string;
  userAgent: string;
  user?: string;
  type: "created" | "updated" | "deleted";
  date: string;
  slot: string;
  team: string;
  notes?: {
    oldNotes?: string;
    deletionReason?: string;
  };
};

type Key = {
  key: string;
  created: string;
  userName: string;
  teams: string[];
};

const reservations: Reservation[] = [];
const blackouts: Blackout[] = [];
const siteEvents: SiteEvent[] = [];

export async function addReservation(reservation: Reservation) {
  throw new Error("Not implemented");
}

export async function removeReservation(
  { date, slot }: Pick<Reservation, "date" | "slot">,
  details: RemovalDetails
) {
  throw new Error("Not implemented");
}

export async function addBlackout(blackout: Blackout) {
  throw new Error("Not implemented");
}

export async function removeBlackout({ date, slot }: Blackout) {
  throw new Error("Not implemented");
}

export async function addSiteEvent(event: SiteEvent) {
  throw new Error("Not implemented");
}

////// Storage Management //////

// File paths for data storage
const DATA_DIR = resolve("./data");
const YEAR = new Date().getFullYear().toString();
const KEYS_FILE = join(DATA_DIR, "keys.json");
const RESERVATIONS_FILE = join(DATA_DIR, YEAR, "reservations.json");
const BLACKOUTS_FILE = join(DATA_DIR, YEAR, "blackouts.json");
const SITE_EVENTS_FILE = join(DATA_DIR, YEAR, "site_events.json");
const LOGS_FILE = join(DATA_DIR, YEAR, "logs.txt");

// Ensure data directory exists
async function ensureDataDirectory() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("Error creating data directory:", err);
    process.exit(1);
  }
}

// Read JSON data from a file
async function readJsonFile(filePath: string) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      return []; // Return empty array if file doesn't exist
    }
    throw err;
  }
}

type ArrayOrNot<T> = T | T[];

type JsonData =
  | ArrayOrNot<
      null | string | number | boolean | { [key: string | number]: JsonData }
    >
  | JsonData[];

// Write JSON data to a file
async function writeJsonFile(filePath: string, data: JsonData) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing to file:", filePath, err);
  }
}

// Append a log entry to the logs file
async function appendLog(logEntry: JsonData) {
  try {
    const logLine = JSON.stringify(logEntry) + "\n";
    await fs.appendFile(LOGS_FILE, logLine, "utf-8");
  } catch (err) {
    console.error("Error appending to logs file:", err);
  }
}

// Initialize data files
async function initializeDataFiles() {
  await ensureDataDirectory();

  const files = [
    RESERVATIONS_FILE,
    BLACKOUTS_FILE,
    KEYS_FILE,
    SITE_EVENTS_FILE,
  ];
  for (const file of files) {
    try {
      await fs.access(file);
    } catch (err) {
      if (err.code === "ENOENT") {
        await writeJsonFile(file, []); // Initialize as empty array
      } else {
        console.error("Error accessing file:", file, err);
      }
    }
  }

  // Ensure logs file exists
  try {
    await fs.access(LOGS_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      await fs.writeFile(LOGS_FILE, "", "utf-8"); // Initialize as empty file
    } else {
      console.error("Error accessing logs file:", err);
    }
  }
}
