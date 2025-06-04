"use client";

import styles from "../index.module.css";

export function Title() {
	const classes = [styles.title];

	return <h1 className={classes.join(" ")}>Practice Field Scheduler</h1>;
}
