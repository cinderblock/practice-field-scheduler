"use client";

import styles from "../index.module.css";
import { useInterval } from "./useInterval";

function isPride() {
	const now = new Date();
	return now.getMonth() === 5; // June is month 5 (0-based)
}

export function Title() {
	const showRainbow = useInterval(isPride, 1000);

	const classes = [styles.title];

	if (showRainbow) classes.push(styles.rainbowText, styles.rainbowTextAnimated);

	return <h1 className={classes.join(" ")}>Practice Field Scheduler</h1>;
}
