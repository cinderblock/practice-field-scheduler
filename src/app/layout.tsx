import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";
import { AppConfigProvider } from "./_components/AppConfig";

export const metadata: Metadata = {
	title: env.SITE_TITLE,
	description: "Schedule your practice field time",
	icons: [
		{ rel: "icon", url: "/favicon-light.ico", media: "(prefers-color-scheme: light)" },
		{ rel: "icon", url: "/favicon-dark.ico", media: "(prefers-color-scheme: dark)" },
	],
};

const geist = Geist({
	subsets: ["latin"],
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	// Read on the server, every request: the image is deployment-agnostic and ops
	// supplies these. See src/app/_components/AppConfig.tsx.
	const config = {
		siteTitle: env.SITE_TITLE,
		timeZone: env.TIME_ZONE,
		timeSlotBorders: env.TIME_SLOT_BORDERS,
		reservationDays: env.RESERVATION_DAYS,
	};

	return (
		<html lang="en">
			<body className={geist.className}>
				<AppConfigProvider value={config}>
					<TRPCReactProvider>{children}</TRPCReactProvider>
				</AppConfigProvider>
			</body>
		</html>
	);
}
