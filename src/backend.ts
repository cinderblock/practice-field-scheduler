/**
 * This file handles the connection to the backend and provides a way to send and receive messages.
 */

import { useCallback, useEffect, useState, type DependencyList } from "react";
import type { Reservation, SiteEvent, Blackout, AddReservationArgs, RemoveReservationArgs } from "../types";

const url = new URL(window.location.href);
url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
url.pathname = "/ws";

const ws = new WebSocket(url);

ws.addEventListener("open", () => {
  console.log("Connected to backend");

  ws.send(JSON.stringify({ type: "hello" }));
});

ws.addEventListener("close", () => {
  console.log("Disconnected from backend");
});

ws.addEventListener("error", event => {
  console.error("WebSocket error:", event);
});

const handler = (event: MessageEvent<string>) => wsMessageHandler(event);

// Add a flag to track if the handler is already attached
let handlerAttached = false;

function attachGlobalHandler() {
  if (!handlerAttached) {
    ws.addEventListener("message", handler);
    handlerAttached = true;
  } else {
    console.warn("Handler already attached, not attaching again.");
  }
}

function detachGlobalHandler() {
  if (handlerAttached) {
    ws.removeEventListener("message", handler);
    handlerAttached = false;
  } else {
    console.warn("Handler not attached, not detaching again.");
  }
}

attachGlobalHandler();

type Storage = {
  reservations: Reservation[];
  siteEvents: SiteEvent[];
  blackouts: Blackout[];
};

const storage: Storage = {
  reservations: [],
  siteEvents: [],
  blackouts: [],
};

const updateListeners: ((storage: Storage) => void)[] = [];
function addUpdateListener(listener: (storage: Storage) => void) {
  if (updateListeners.length === 0) attachGlobalHandler();

  updateListeners.push(listener);
  return () => {
    const index = updateListeners.indexOf(listener);
    if (index !== -1) updateListeners.splice(index, 1);

    if (updateListeners.length === 0) detachGlobalHandler();
  };
}

function wsMessageHandler(event: MessageEvent<string>) {
  const message = event.data;
  console.log("Received message:", message);
  try {
    parseMessage(message);
  } catch (error) {
    console.error("Error parsing message:", error);
  }
}

function parseMessage(message: string) {
  const data = JSON.parse(message);

  if (data.error) {
    console.error(`Error (${data.type}) from backend: ${data.error}`);
    return;
  } else if (data.reservation) updateReservation(data.reservation);
  else if (data.blackout) updateBlackout(data.blackout);
  else if (data.siteEvent) updateSiteEvent(data.siteEvent);
  else {
    console.error("Unknown message type:");
    console.log(data);
    return;
  }

  for (const listener of updateListeners) listener(storage);
}

function updateReservation(reservation: Reservation) {
  const existing = storage.reservations.find(
    r => r.date === reservation.date && r.slot === reservation.slot && r.team === reservation.team,
  );
  if (existing) Object.assign(existing, reservation);
  else storage.reservations.push(reservation);
}
function updateBlackout(blackout: Blackout) {
  const existing = storage.blackouts.find(
    b => b.date === blackout.date && b.slot === blackout.slot && b.created === blackout.created,
  );
  if (existing) Object.assign(existing, blackout);
  else storage.blackouts.push(blackout);
}
function updateSiteEvent(siteEvent: SiteEvent) {
  const existing = storage.siteEvents.find(e => e.date === siteEvent.date && e.created === siteEvent.created);
  if (existing) Object.assign(existing, siteEvent);
  else storage.siteEvents.push(siteEvent);
}

type Selector<T> = (s: Storage) => T | undefined;

export function useBackend<T>(selector: Selector<T>, deps: DependencyList = []): T | undefined {
  const [data, setData] = useState<undefined | T>();

  // We don't add the selector to the dependency array because it gets recreated on every render
  // We could call useCallback where useBackend is called, but why repeat that everywhere?
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const listener = useCallback((storage: Storage) => setData(selector(storage)), [setData, ...deps]);

  useEffect(() => addUpdateListener(listener), [listener]);

  return data;
}

export function addReservation(reservation: AddReservationArgs) {
  ws.send(JSON.stringify({ type: "addReservation", ...reservation }));
}
export function removeReservation(reservation: RemoveReservationArgs) {
  ws.send(JSON.stringify({ type: "removeReservation", ...reservation }));
}
export function addBlackout(blackout: Blackout) {
  ws.send(JSON.stringify({ type: "addBlackout", ...blackout }));
}
export function removeBlackout(blackout: Blackout) {
  ws.send(JSON.stringify({ type: "removeBlackout", ...blackout }));
}
export function addSiteEvent(event: SiteEvent) {
  ws.send(JSON.stringify({ type: "addSiteEvent", ...event }));
}
export function removeSiteEvent(event: SiteEvent) {
  ws.send(JSON.stringify({ type: "removeSiteEvent", ...event }));
}
