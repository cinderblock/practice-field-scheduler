"use client";

import styles from "../index.module.css";
import { useInterval } from "./useInterval";
import { env } from "~/env";

const enablePride = false;

function isPride() {
	const now = new Date();
	return now.getMonth() === 5; // June is month 5 (0-based)
}

export function Title() {
	const showRainbow = useInterval(isPride, 1000) && enablePride;

	const classes = [styles.title];

	if (showRainbow) classes.push(styles.rainbowText, styles.rainbowTextAnimated);

	return <h1 className={classes.join(" ")}>{env.NEXT_PUBLIC_SITE_TITLE}</h1>;
}
