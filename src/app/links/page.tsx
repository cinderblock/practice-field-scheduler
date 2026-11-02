"use server";

import { redirect } from "next/navigation";
import { TSLLogo } from "~/app/_components/TSLLogo";
import page from "~/app/users/users.module.css";
import { auth } from "~/server/auth";
import styles from "../index.module.css";
import { MyGateLinks } from "./_components/MyGateLinks";

export default async function LinksPage() {
	const session = await auth();
	if (!session) {
		redirect("/");
	}

	return (
		<div className={page.page}>
			<div className={page.header}>
				<div className={page.logo}>
					<TSLLogo />
				</div>
				<h1 className={styles.title}>My gate links</h1>
			</div>
			<MyGateLinks />
		</div>
	);
}
