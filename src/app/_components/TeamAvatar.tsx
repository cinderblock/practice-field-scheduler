"use client";

import { useState } from "react";
import styles from "./TeamAvatar.module.css";

interface TeamAvatarProps {
	teamNumber: number;
	alt?: string;
	className?: string;
	size?: number | string;
}

export function TeamAvatar({ teamNumber, alt, className = "", size = 64 }: TeamAvatarProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [hasError, setHasError] = useState(false);

	const handleLoadStart = () => {
		setIsLoading(true);
		setHasError(false);
	};

	const handleLoad = () => {
		setIsLoading(false);
		setHasError(false);
	};

	const handleError = () => {
		setIsLoading(false);
		setHasError(true);
	};

	// Convert size to appropriate values for different uses
	const sizeValue = typeof size === "string" ? size : `${size}px`;
	const numericSize = typeof size === "number" ? size : undefined;

	if (hasError) {
		return (
			<div
				className={className}
				style={{
					width: sizeValue,
					height: sizeValue,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: "#e5e7eb",
					color: "#6b7280",
					fontSize: "0.75em",
					fontWeight: "500",
				}}
			>
				{teamNumber}
			</div>
		);
	}

	return (
		<div
			className={className}
			style={{
				position: "relative",
				width: sizeValue,
				height: sizeValue,
			}}
		>
			{isLoading && (
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: "#f3f4f6",
					}}
				>
					<div
						className={styles.loadingIndicator}
						style={{
							width: "0.5em",
							height: "0.5em",
							backgroundColor: "#d1d5db",
							borderRadius: "50%",
						}}
					/>
				</div>
			)}
			<img
				src={`/api/team-avatar/${teamNumber}`}
				alt={alt ?? `Team ${teamNumber} avatar`}
				width={numericSize}
				height={numericSize}
				onLoadStart={handleLoadStart}
				onLoad={handleLoad}
				onError={handleError}
				style={{
					borderRadius: "4px",
					width: sizeValue,
					height: sizeValue,
					opacity: isLoading ? 0 : 1,
					transition: "opacity 200ms ease-in-out",
				}}
			/>
		</div>
	);
}
