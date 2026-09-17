"use client";

import { createContext, useContext } from "react";

/**
 * The deployment's settings that the browser needs.
 *
 * They deliberately aren't `NEXT_PUBLIC_*`: Next.js bakes those into the bundle
 * at `next build`, and this app's image is built once by CI and then run by ops
 * on whatever deployment it pins (production and staging differ in title, and
 * could differ in timezone or slots). So the server reads them at runtime and
 * hands them down from the root layout instead.
 */
export type AppConfig = {
	/** Shown in the page title and the header. */
	siteTitle: string;
	/** IANA name. All calendar dates and times are in this zone, not the visitor's. */
	timeZone: string;
	/** Slot boundaries in hours relative to noon, ascending. */
	timeSlotBorders: number[];
	/** How many days ahead the calendar shows. */
	reservationDays: number;
};

const AppConfigContext = createContext<AppConfig | null>(null);

export function AppConfigProvider({ value, children }: { value: AppConfig; children: React.ReactNode }) {
	return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

/** The deployment's settings. Throws if rendered outside the root layout's provider. */
export function useAppConfig(): AppConfig {
	const config = useContext(AppConfigContext);
	if (!config) throw new Error("useAppConfig must be used inside AppConfigProvider (see src/app/layout.tsx)");
	return config;
}
