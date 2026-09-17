# Booking regression: no non-admin could add a reservation

## Goal

Restore booking for ordinary (non-admin) users, and make the next report of "I
can't book" diagnosable in one grep instead of a day of archaeology.

Reported 2026-09-17: a user could fill in the Add Reservation dialog and press
Add, and nothing happened — the dialog stayed open and no reservation was
created. An admin (the user) could book the same slot fine.

## Environment / context

- Repo: `C:/Users/camer/git/playgrounds/practice-field-scheduler`, branch
  `fix-booking-regression` off `master`.
- Production: `steamboat`, systemd unit `practice-field-scheduler.service`,
  checkout at `/opt/practice-field-scheduler`. Server timezone
  `America/Los_Angeles`, same as `TIME_ZONE`.
- CI on `master` now only builds and publishes a container image
  (`ghcr.io/cinderblock/practice-field-scheduler:<sha>`). The old self-hosted
  deploy workflow was removed in `3a3615b`, and the ops-owned image cutover has
  not happened yet, so a deploy today is the old manual recipe: pull, `npm ci`,
  `npm run build`, restart the unit.
- Peer session `t3code-2ac884c3-7b` has box access and confirmed the diagnosis
  from the journal; it owns the ops-side cutover, not this fix.

## Diagnosis (confirmed, not theory)

1. `addReservation` calls three checks: `restrictToTeam`, `restrictTimeframe`,
   `restrictBlackout`. The first two were called **without `await`** from
   2025-05-23 until 2026-09-15, so for over a year they returned an ignored
   promise and never refused anything. 113 same-day bookings in the logs prove
   same-day booking worked the whole time.
2. Commits `f04da28` and `70299a3` (2026-09-15, deployed 09-16) each added a
   missing `await`. Nothing else changed. That switched on two rules that had
   never actually run.
3. `restrictTimeframe` compared `new Date("YYYY-MM-DD")` (midnight **UTC**)
   against `setHours(0, 0, 0, 0)` (midnight **local**). In Pacific the field's
   own date is 7-8 hours behind UTC midnight, so "today" always read as the
   past. Every non-admin booking for today was refused.
4. `restrictToTeam` requires the user's record to list the team they are booking
   for. 31 of 34 active non-admins have no teams recorded at all, and no user
   record mentions team 5940 (the team in the report), so it refused nearly
   every booking for every date.
5. The Add dialog swallowed the error: `onError` rolled the optimistic pill back
   and set no message, and the dialog only closes on success. That is exactly
   what the user saw — press Add, nothing happens.
6. The journal showed the shape of it: on 2026-09-17 only one reservation was
   created all day (by an admin, the full START → lock → END sequence). Every
   other attempt logged `addReservation START` and then nothing, because a
   refusal threw before the lock and logged nothing at all.

Ruled out: blackouts (the only one is 2026-09-27), the restart (no deploy that
day; the 15:21 restart changed no code or data), and a lock deadlock (the
"Lock acquired" lines are present — the peer retracted that lead).

## Decisions already made (don't re-ask)

- **The window is compared as calendar dates in `TIME_ZONE`**, as zero-padded
  `YYYY-MM-DD` strings. Bookable = today through today + 7, inclusive. No `Date`
  arithmetic, so no UTC-vs-local mismatch and no drift with the time of day (the
  old upper bound was `now + 7 days`, which made the seventh day bookable in the
  morning and refused in the evening).
- **Team membership is not enforced yet**, behind `EnforceTeamMembership =
false` in `src/server/backend.ts`. Enforcing a rule that has never actually
  run, against team data that doesn't exist for 31 of 34 users, would lock the
  club out. Mismatches are logged (`allowed despite team mismatch`) so the
  journal shows exactly who enabling it would block. Flip the constant when user
  records carry teams — `test/unit/reservationWindow.test.ts` documents the
  current policy and will fail as the reminder.
- **Every refusal on the reservation path is logged server-side**, through
  `Context.refuse()`. This is worth as much as the UI message: the whole
  investigation existed because refusals were invisible.
- Admins stay exempt from the window, blackouts, and team membership.

## Changes

- `src/server/util/slotTime.ts`: `formatFieldDate`, `fieldToday`,
  `addFieldDays` — calendar arithmetic via UTC (no DST) in the field's zone.
- `src/server/backend.ts`: rewrote `restrictTimeframe` on string dates; added
  `refuse()` + `userIdForLog()`; `restrictBlackout` and `restrictToTeam` refuse
  through it; `EnforceTeamMembership` flag; fixed one more un-awaited
  `isAdmin()` in `getUsers()` (both callers are admin-gated pages, so nothing
  leaked, but the filter it guarded never ran).
- `src/app/_components/ReservationCalendar.tsx`: an `error` state set by both
  mutations, shown inside the Add dialog (`role="alert"`) and as a
  tap-to-dismiss notice in the slot when a removal fails; the Add button
  disables and reads "Adding..." while in flight.
- `src/app/index.module.css`: `.modalError`, `.slotError`.
- Tests: `test/unit/reservationWindow.test.ts` (new, against the real backend,
  clock pinned to 22:30 Pacific so the old code fails whatever zone the test
  host is in) and window/DST cases in `test/unit/slotTime.test.ts`.

## Findings / gotchas

- Fake timers: `vi.useFakeTimers({ toFake: ["Date"] })` only. Faking the whole
  timer set risks hanging the backend's locks and writes. Calling
  `useFakeTimers` a second time does **not** move the clock — use
  `vi.setSystemTime()` for that (cost me one failing test).
- A test that books "today" is green on CI (UTC) even with the bug, because in
  UTC local midnight and UTC midnight coincide. Pinning the clock to the evening
  in Pacific is what makes the regression test meaningful anywhere.
- Mutation-tested both ways: restoring the old `restrictTimeframe` fails the new
  tests under `TZ=UTC` (3) and under `TZ=America/Los_Angeles` (4), including
  "lets a team book the evening it is standing in"; setting
  `EnforceTeamMembership = true` fails the team-membership test. Neither test is
  vacuous.
- **Install the Date mock only after the backend has been imported.**
  `@date-fns/tz` subclasses whatever `Date` is global when it loads, and a
  subclass of vitest's mock resolves dates in the _host's_ zone rather than
  TIME_ZONE. Faking first made the test pass here (Pacific) and fail on CI
  (UTC) for reasons unrelated to the code under test. Fixed in `a33d200`, which
  also pins `process.env.TIME_ZONE` in the test instead of inheriting it.

## Progress log

- [x] Diagnose (logs, data files, git history, server timezone)
- [x] Claim the fix; peer `t3code-2ac884c3-7b` stood down
- [x] Timezone-correct booking window + helpers
- [x] Team-membership policy: log, don't enforce
- [x] Server-side logging of refusals
- [x] Surface mutation errors in the calendar UI
- [x] Regression tests, mutation-verified
- [x] typecheck + biome + prettier + 319 unit tests green
- [x] Committed `4aee0bb`, fast-forwarded `master`, pushed
- [x] Test-portability follow-up `a33d200` (CI caught it -- see below)
- [x] Deployed to production the old way: pull, `npm ci`, `npm run build`,
      `systemctl restart`. Service active, `/login` 200, static chunks 200, and
      `allowed despite team mismatch` is present in `.next/server`, so the new
      code really is what is serving.
- [ ] Confirm a real non-admin booking works (needs the reporting user to retry;
      `journalctl -u practice-field-scheduler -g "refused|mismatch"` will say
      what happened either way)
- [x] Handed the published image digest to the ops session for the eventual pin:
      `ghcr.io/cinderblock/practice-field-scheduler@sha256:8a48be6e05a00ddaf7516db28f3190dcec979dbceae48aa3e8a7d41046715412`,
      revision `4f28f1f`, verified pullable anonymously. Production is **not**
      running that image -- steamboat is still the systemd path built from
      source. Note `build.yml`'s concurrency group cancels an in-flight build on
      the next push, so the `a33d200` image never published; a plan-only commit
      wants `[skip ci]`.
- [ ] Decide whether `SLACK_BOT_TOKEN`, `SCHEDULER_API_KEY` and `GATE_BASE_URL`
      go into the box's `.env` now or wait for the ops stack to own them (see
      Deploy notes)

## Deploy notes (2026-09-17)

- The checkout is owned by `github`, not `cameron`: every git/npm step needs
  `sudo -u github`. The unit runs `npm start` as `github`, `PORT=9002`.
- **The box's `.env` still used the old `NEXT_PUBLIC_*` names**, so the first
  build failed with "Invalid environment variables" before it produced anything
  (the running service was untouched). Renamed in place --
  `NEXT_PUBLIC_{SITE_TITLE,TIME_ZONE,TIME_SLOT_BORDERS,RESERVATION_DAYS}` to the
  bare names the server block now expects. Backup at `.env.bak-20260917`.
  `AUTH_SLACK_SIGNING_SECRET` is still in that file and nothing reads it.
- **`SLACK_BOT_TOKEN`, `SCHEDULER_API_KEY` and `GATE_BASE_URL` are not set on
  the box** (not in `.env`, `.env.local` or the unit). They are all optional in
  the schema, so the app runs -- but gate links, the Slack DMs and
  `/api/access/check` are inert in production. Those values live in ops secrets
  and were meant to arrive with the image cutover that got rolled back. Needs a
  decision: add them to the box's `.env` now, or wait for the cutover.
- `next start` now warns `"next start" does not work with "output: standalone"`,
  because the image work added `output: "standalone"`. It does serve correctly
  (pages, RSC payloads and `/_next/static` chunks all 200) -- but the old path
  is living on borrowed time; the real answer is the ops-pinned image.

## Things not to do

- Don't "fix" the window by widening it or by special-casing today. The rule is
  a calendar comparison in the field's zone; anything involving `new Date(date)`
  is how this broke.
- Don't switch on `EnforceTeamMembership` without the team data. It is not a
  code problem.
- Don't add a `title=` tooltip for the error text. It has to be visible.
