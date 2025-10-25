"use client";

import styles from "../index.module.css";
import { useHistory } from "./HistoryContext";

export function HistoryButton() {
	const { isLoadingHistory, loadHistory } = useHistory();

	return (
		<button
			onClick={loadHistory}
			disabled={isLoadingHistory}
			className={styles.logoutButtonSmall}
			type="button"
			style={{
				cursor: isLoadingHistory ? "not-allowed" : "pointer",
				opacity: isLoadingHistory ? 0.5 : 1,
			}}
		>
			History
		</button>
	);
}
