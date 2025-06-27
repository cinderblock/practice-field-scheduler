import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";
export const metadata: Metadata = {
	title: env.NEXT_PUBLIC_SITE_TITLE,
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
	return (
		<html lang="en">
			<body className={geist.className}>
				<TRPCReactProvider>{children}</TRPCReactProvider>
			</body>
		</html>
	);
}
