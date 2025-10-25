import type { Blackout, Reservation, SiteEvent } from "~/types";

// TODO: Implement proper WebSocket handling
export async function tellClientsAboutReservationChange(_reservation: Reservation) {
	// TODO: Implement
}

export async function tellClientsAboutBlackoutChange(blackout: Blackout) {
	console.log("Blackout changed:", blackout);
}

export async function tellClientsAboutSiteEvent(event: SiteEvent) {
	console.log("Site event changed:", event);
}
