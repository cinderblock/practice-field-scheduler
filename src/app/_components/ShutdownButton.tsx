"use client";

import { useState } from "react";
import styles from "../index.module.css";

export function ShutdownButton() {
	const [isShuttingDown, setIsShuttingDown] = useState(false);

	const handleShutdown = async () => {
		if (isShuttingDown) return;

		setIsShuttingDown(true);

		try {
			// Call the shutdown endpoint
			const response = await fetch("/api/shutdown", {
				method: "POST",
			});

			if (response.ok) {
				// Wait 0.1 seconds then refresh the page
				setTimeout(() => {
					window.location.reload();
				}, 100);
			} else {
				console.error("Failed to shutdown server");
				setIsShuttingDown(false);
			}
		} catch (error) {
			console.error("Error calling shutdown endpoint:", error);
			setIsShuttingDown(false);
		}
	};

	return (
		<button
			type="button"
			onClick={handleShutdown}
			disabled={isShuttingDown}
			className={styles.shutdownButton}
			aria-label="Shutdown staging server"
			title="Shutdown staging server"
		>
			<span
				style={{
					position: "absolute",
					width: "1px",
					height: "1px",
					padding: "0",
					margin: "-1px",
					overflow: "hidden",
					clip: "rect(0, 0, 0, 0)",
					whiteSpace: "nowrap",
					border: "0",
				}}
			>
				Shutdown staging server
			</span>
			{isShuttingDown ? "🔄" : "🔴"}
		</button>
	);
}
