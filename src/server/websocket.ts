console.log("Loading websocket.ts");

import type { Blackout, Reservation, SiteEvent } from "~/types";

// TODO: Implement proper WebSocket handling
export async function tellClientsAboutReservationChange(reservation: Reservation) {
	// For now, just log the change
	console.log(
		`Reservation changed - ${reservation.id} - ${reservation.date} - ${reservation.slot} - ${reservation.team}`,
	);
}

export async function tellClientsAboutBlackoutChange(blackout: Blackout) {
	console.log("Blackout changed:", blackout);
}

export async function tellClientsAboutSiteEvent(event: SiteEvent) {
	console.log("Site event changed:", event);
}
