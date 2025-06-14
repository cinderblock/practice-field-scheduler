import Link from "next/link";
import { TSLLogo } from "~/app/_components/TSLLogo";
import styles from "../index.module.css";

export default function NotFound() {
	return (
		<div style={{ width: "100%", maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
			<div
				style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}
			>
				<div style={{ maxWidth: "100px", width: "100%" }}>
					<TSLLogo />
				</div>
				<h1 className={styles.title}>Access Denied</h1>
				<p style={{ textAlign: "center", color: "var(--text-secondary)" }}>
					You do not have permission to view the system logs.
				</p>
				<Link
					href="/"
					style={{
						display: "inline-block",
						padding: "0.5rem 1rem",
						background: "var(--accent-color)",
						color: "var(--background-primary)",
						borderRadius: "0.5rem",
						textDecoration: "none",
						marginTop: "1rem",
					}}
				>
					Return to Home
				</Link>
			</div>
		</div>
	);
}
