"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import styles from "./CalendarFeedButtons.module.css";
import { env } from "~/env";

const BaseUrl = "/api/calendar/";

interface Props {
	teams: number[];
}

// Add a nonce to the webcal URI to avoid caching issues on dev server
const isDev = process.env.NODE_ENV !== "production";

function getWebcalURI(path: string, origin: string) {
	const nonce = isDev ? `?${Math.random().toString(36).slice(2)}` : "";
	return `webcal://${origin.replace(/^https?:\/\//, "")}${BaseUrl}${path}${nonce}`;
}

export default function CalendarFeedButtons({ teams }: Props) {
	const origin = typeof window !== "undefined" ? window.location.origin : env.NEXTAUTH_URL;

	const feeds = useMemo(() => {
		const base = [
			{ key: "all", label: "All Events & Reservations", path: "all" },
			{ key: "site", label: "Site Events & Blackouts", path: "site" },
		];
		const teamFeeds = teams.map(team => ({
			key: `team-${team}`,
			label: `Team ${team} Reservations`,
			path: team.toString(),
		}));
		return [...base, ...teamFeeds];
	}, [teams]);

	return (
		<section className={styles.container}>
			<h3>Add to your calendar</h3>
			<ul className={styles.feedList}>
				{feeds.map(feed => {
					const webcal = getWebcalURI(feed.path, origin);
					return (
						<li key={feed.key} className={styles.feedItem}>
							<CopyButton copyText={webcal}>{feed.label}</CopyButton>
							<Link href={webcal} title="Open feed URL" className={styles.linkIcon}>
								🔗
							</Link>
							<AddToGoogleCalendarIcon size={20} webcalURI={webcal} className={styles.appIcon} />
							<AddToOutlookCalendarIcon size={20} webcalURI={webcal} name={feed.label} className={styles.appIcon} />
						</li>
					);
				})}
				<li className={styles.feedItem} style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
					<span>Click to copy URL</span>
					<span style={{ textWrap: "nowrap" }}>Or add directly...</span>
				</li>
			</ul>
		</section>
	);
}

function CopyButton({ children, copyText }: { children: React.ReactNode; copyText: string }) {
	const [copied, setCopied] = useState<boolean>(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(copyText);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch (err) {
			console.error("Failed to copy to clipboard", err);
		}
	};
	return (
		<button onClick={copy} className={styles.copyButton} title="Copy feed URL" type="button">
			<span className={copied ? styles.labelHidden : undefined}>{children}</span>
			{copied && <span className={`${styles.copyIndicator} ${styles.fadeOut}`}>Copied!</span>}
		</button>
	);
}

function Link({
	children,
	href,
	title,
	className,
	newTab,
}: { children: React.ReactNode; href: string; title: string; className?: string; newTab?: boolean }) {
	return (
		<a
			href={href}
			className={className}
			title={title}
			suppressHydrationWarning={isDev}
			target={newTab ? "_blank" : undefined}
			rel={newTab ? "noopener noreferrer" : undefined}
		>
			{children}
		</a>
	);
}

function GoogleCalendarIcon({ size }: { size: number }) {
	return <Image src="/Google_Calendar_icon_(2020).svg" alt="Google Calendar" width={size} height={size} />;
}

function OutlookCalendarIcon({ size }: { size: number }) {
	return <Image src="/Microsoft_Office_Outlook_(2018–present).svg" alt="Outlook Calendar" width={size} height={size} />;
}

function AddToGoogleCalendarIcon({
	size,
	webcalURI,
	className,
}: { size: number; webcalURI: string; className?: string }) {
	return (
		<Link
			href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalURI)}`}
			className={className}
			title="Add to Google Calendar"
			newTab
		>
			<GoogleCalendarIcon size={size} />
		</Link>
	);
}

function AddToOutlookCalendarIcon({
	size,
	webcalURI,
	name,
	className,
}: { size: number; webcalURI: string; name: string; className?: string }) {
	return (
		<Link
			href={`https://outlook.live.com/calendar/0/addfromweb/?url=${encodeURIComponent(webcalURI)}&name=${encodeURIComponent(name)}`}
			className={className}
			title="Add to Outlook Calendar"
			newTab
		>
			<OutlookCalendarIcon size={size} />
		</Link>
	);
}

// cSpell:ignore webcal
