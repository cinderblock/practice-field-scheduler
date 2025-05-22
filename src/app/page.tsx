import Link from "next/link";

import { LatestPost } from "~/app/_components/post";
import { ReservationCalendar } from "~/app/_components/ReservationCalendar";
import { auth } from "~/server/auth";
import { HydrateClient } from "~/trpc/server";
import styles from "./index.module.css";
import type { Session } from "next-auth";

export default async function Home() {
  const session = await auth();

  return (
    <HydrateClient>
      <main className={styles.main}>
        <div className={styles.container}>
          <h1 className={styles.title}>Practice Field Scheduler</h1>
          {session ? <LoggedIn session={session} /> : <LoginButton />}
        </div>
      </main>
    </HydrateClient>
  );
}

function toLocalDateString(date: Date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const yyyy = y.toString().padStart(4, "0");
  const mm = m.toString().padStart(2, "0");
  const dd = d.toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function LoggedIn({ session }: { session: Session }) {
  return (
    <div className={styles.reservationCalendar}>
      <div className={styles.showcaseText + " " + styles.showcaseRow}>
        <span>Logged in as {session.user?.name}</span>
        <Link href="/api/auth/signout" className={styles.logoutButtonSmall}>
          Sign out
        </Link>
      </div>
      <ReservationCalendar />
    </div>
  );
}

function LoginButton() {
  return (
    <>
      <h2>Please log in to view the reservation calendar.</h2>
      <Link href="/api/auth/signin" className={styles.loginButton}>
        Sign in
      </Link>
    </>
  );
}

async function oldBody({ session }: { session: Session }) {
  const hello = await api.post.hello({ text: "from tRPC" });
  return (
    <>
      <div className={styles.cardRow}>
        <Link
          className={styles.card}
          href="https://create.t3.gg/en/usage/first-steps"
          target="_blank"
						>
							<h3 className={styles.cardTitle}>First Steps →</h3>
							<div className={styles.cardText}>
								Just the basics - Everything you need to know to set up your
								database and authentication.
							</div>
						</Link>
						<Link
          className={styles.card}
          href="https://create.t3.gg/en/introduction"
          target="_blank"
						>
							<h3 className={styles.cardTitle}>Documentation →</h3>
							<div className={styles.cardText}>
								Learn more about Create T3 App, the libraries it uses, and how
								to deploy it.
							</div>
						</Link>
					</div>
      <div className={styles.showcaseContainer}>
        <p className={styles.showcaseText}>
          {hello ? hello.greeting : "Loading tRPC query..."}
        </p>

        <div className={styles.authContainer}>
          <p className={styles.showcaseText}>
            {session && <span>Logged in as {session.user?.name}</span>}
          </p>
          <Link
            href={session ? "/api/auth/signout" : "/api/auth/signin"}
            className={styles.loginButton}
          >
            {session ? "Sign out" : "Sign in"}
          </Link>
        </div>
      </div>

      {session?.user && <LatestPost />}
    </>
  );
}
