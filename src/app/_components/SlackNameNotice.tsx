"use client";

import { describeSlackNameIssue } from "~/server/util/slackName";
import { api } from "~/trpc/react";
import styles from "./SlackNameNotice.module.css";

/**
 * Tells the signed-in person about their own Slack names when they need
 * fixing. The names decide exactly one thing -- whether they receive gate
 * links -- so the notice says so, and that booking is unaffected either way.
 *
 * "Check again" re-reads Slack straight away (the background refresh is
 * throttled), so fixing the profile and coming back is a two-step loop.
 */
export function SlackNameNotice() {
	const utils = api.useUtils();
	const names = api.slack.myNames.useQuery();
	const recheck = api.slack.recheckMyNames.useMutation({
		onSuccess: data => utils.slack.myNames.setData(undefined, data),
	});

	const data = names.data;
	if (!data || data.ok) return null;

	const unidentified = !data.identified;
	const suggestion = data.suggestion;

	return (
		<section className={styles.notice} aria-live="polite">
			<h3 className={styles.title}>
				{unidentified
					? "We couldn't match your account to Slack"
					: "Your Slack names need a fix before you can get gate links"}
			</h3>

			{unidentified ? (
				<p>
					Your sign-in doesn't carry your Slack account, and no Slack account uses this email. Sign out and sign in
					again. If this notice stays, tell an admin.
				</p>
			) : (
				<>
					<ul className={styles.issues}>
						{data.issues.map(issue => (
							<li key={issue}>{describeSlackNameIssue(issue)}</li>
						))}
					</ul>
					<p>
						Slack has your full name as <code>{data.realName || "(empty)"}</code> and your display name as{" "}
						<code>{data.displayName || "(empty)"}</code>.
					</p>
					{suggestion && (suggestion.realName || suggestion.displayName) && (
						<p>
							Suggested:{" "}
							{suggestion.realName && (
								<>
									full name <code>{suggestion.realName}</code>
								</>
							)}
							{suggestion.realName && suggestion.displayName && ", "}
							{suggestion.displayName && (
								<>
									display name <code>{suggestion.displayName}</code>
								</>
							)}
							.
						</p>
					)}
					<p>
						<strong>Full name</strong>: just your name, e.g. <code>Jane Doe</code>. <strong>Display name</strong>: your
						name, then your team number(s) in parentheses, e.g. <code>Jane Doe (1234)</code> or{" "}
						<code>Jane Doe (1234, 5678)</code>. Lab mates without a team use <code>(TSL)</code>.
					</p>
					<p>
						In Slack, open your profile, choose <em>Edit profile</em>, save, then come back here and press{" "}
						<strong>Check again</strong>.
					</p>
					<div className={styles.actions}>
						<button
							type="button"
							className={styles.button}
							onClick={() => recheck.mutate()}
							disabled={recheck.isPending}
						>
							{recheck.isPending ? "Checking..." : "Check again"}
						</button>
						{recheck.error && <span className={styles.error}>{recheck.error.message}</span>}
					</div>
				</>
			)}

			<p className={styles.footnote}>This only affects gate links. Booking field time works either way.</p>
		</section>
	);
}
