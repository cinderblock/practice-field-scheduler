"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense } from "react";
import { TSLLogo } from "~/app/_components/TSLLogo";
import styles from "./login.module.css";

function LogInContent() {
	const searchParams = useSearchParams();
	const error = searchParams.get("error");

	if (error) {
		return (
			<div className={styles.error}>
				{error === "OAuthAccountNotLinked"
					? "This account is already linked to another user."
					: error === "OAuthSignin"
						? "Error occurred during log in. Please try again."
						: "Authentication failed. Please try again."}
			</div>
		);
	}

	return (
		<>
			<h2 className={styles.instructionsTitle}>How to Log In</h2>
			<div className={styles.stepsContainer}>
				<div className={styles.step}>
					<div className={styles.stepNumber}>1</div>
					<div className={styles.stepContent}>
						<h3 className={styles.stepTitle}>Log into Slack</h3>
						<p className={styles.stepDescription}>
							Make sure you're logged in to{" "}
							<a
								href="https://tomsawyerlabs.slack.com"
								target="_blank"
								rel="noopener noreferrer"
								className={styles.link}
							>
								Tom Sawyer Labs's Slack
							</a>
						</p>
					</div>
				</div>
				<div className={styles.step}>
					<div className={styles.stepNumber}>2</div>
					<div className={styles.stepContent}>
						<h3 className={styles.stepTitle}>Access the Scheduler</h3>
						<p className={styles.stepDescription}>
							Click below to connect your Slack account to the Practice Field Scheduler. First time? You'll need to{" "}
							<span className={styles.hoverTrigger}>allow access</span>.
						</p>
						<div className={styles.imageContainer}>
							<Image
								src="/slack-allow.png"
								alt="Slack permissions"
								width={579}
								height={666}
								className={styles.hoverImage}
							/>
						</div>
					</div>
				</div>
			</div>
			<button type="button" onClick={() => signIn("slack")} className={styles.logInButton}>
				<svg
					className={styles.slackIcon}
					viewBox="0 0 24 24"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-label="Slack logo"
				>
					<title>Slack</title>
					<path
						d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
						fill="currentColor"
					/>
				</svg>
				Log in to the Scheduler with Slack
			</button>
		</>
	);
}

export default function LogInPage() {
	return (
		<div className={styles.container}>
			<div className={styles.card}>
				<div className={styles.logoContainer}>
					<TSLLogo />
				</div>
				<Suspense fallback={<div>Loading...</div>}>
					<LogInContent />
				</Suspense>
			</div>
		</div>
	);
}
