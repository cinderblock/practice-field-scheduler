# Precedence for teams with an upcoming FRC event (#8)

## Goal

GitHub issue #8: "When teams have upcoming events, we should detect that and give more precedence
to those teams." It builds on #7 (our teams' FRC events, `plans/frc-events.md`). "Precedence" itself
is defined by #9 (priority reservations) and #10 (limits on priority reservations), which are still
being designed in their own threads.

## Context

- #9 landed on master in `bc663fb` (PR #58, `plans/reservation-priority-waitlist.md`). A slot's
  lines are ordered priority first, then booking order (`orderSlot` in
  `src/server/util/reservation.ts`). The first `SLOT_CAPACITY` (4) get the field, the rest are
  waitlisted. The order is derived every time, never stored. A line pushed onto the waitlist gets a
  DM (`standingChanges`). `gotPriorityPlace` is #10's hook.
- #7 provides, on master since `d00af5f`:
  - `getFrcEvents()` / tRPC `frcEvents.list`: `FrcEventsSnapshot | null`, memory-only, refreshed
    every 6h. Each `FrcEvent` has `start`/`end` (event-local dates) and `teams` (our team numbers).
  - `getTeamEvents(from, until)` (server) and `eventsByTeam(events, from, until)` (pure).
  - `ReservationCalendar` already queries the events (`frcEvents`).

## Decisions (user, 2026-11-21; don't re-ask)

1. **Effects:** a badge on the calendar (A), auto-priority through #9 (C), and a bigger allowance
   through #10 (D). **Not** a longer booking window: `restrictTimeframe` stays at 7 days for everyone.
2. **Window:** from 7 days before an event's first day through its last day (`EventLeadDays`).
3. **Which events:** every event #7 loads, off-season included. No admin override.
4. The team that counts on a guest line is `team` (the robot practicing), not `host`.

## Design

- **`eventLeadFor(events, team, date)`** in `src/server/util/frcEvents.ts` (pure, client-safe):
  the earliest event `team` is registered for that starts within 7 days after `date` or is under
  way on it, with `daysBefore`. Non-numeric teams never match. `describeEventLead` words it.
- **Badge (done):** `ReservationCalendar` passes `events` down to each `TimeSlot`; each pill gets a
  🏁 line, and the Add dialog shows the same line for the team being booked. No `title=` tooltips.
- **Auto-priority (C, #9 has landed):** `orderSlot` reads `r.priority`. Feed it
  `r.priority || eventLeadFor(events, r.team, r.date) !== undefined`, computed rather than stored so
  it follows event-list changes, at every `orderSlot`/`slotStandings` call (backend, calendar, ICS
  feed). Open point: an event-list refresh can reorder a slot with no booking to trigger the bump
  DM. Either diff standings after each refresh and DM, or accept a silent reorder.
- **Bigger allowance (D, waits on #10):** #10 (`cced885` on `t3/plan-reservation-limits`, stacked
  on #9's `4b19669`) exposes `priorityAllowance(team, weekStart)` in
  `src/server/util/weeklyLimits.ts`, returning `PRIORITY_PER_WEEK` (1). `weeklyUsage` and the
  refusal in `restrictPriority` both read it. Add the bonus there for teams with an `eventLeadFor`
  hit in that week. #10's rules: Monday–Sunday weeks, guest lines charged to the host, 1 priority
  per week, 7 lines per week (extras sort last, never refused). See
  [#10 comment](https://github.com/cinderblock/practice-field-scheduler/issues/10#issuecomment-7076608192).
- **C and D interact:** `weeklyUsage` counts lines stored with `priority: true`. Deriving
  auto-priority at read time (this plan's choice) means auto-priority lines don't use up the team's
  allowance, which already gives event teams more. Then D's bonus would only add extra _manual_
  priority marks. Decide when building C/D whether both are wanted.
- **Restart gap (must fix before C/D):** #7's snapshot is memory-only, so after a restart
  `getFrcEvents()` is null for about 2×(teams+1) seconds. A badge vanishing briefly is harmless; a
  booking decision changing is not. Before C/D, persist the snapshot to
  `DATA_DIR/<year>/frcEvents.json` and load it at startup.

## Progress

- [x] Design and user choices
- [x] `eventLeadFor` / `describeEventLead` + unit tests (`test/unit/frcEvents.test.ts`)
- [x] Badge on pills and in the Add dialog, checked headlessly at 1280px and 390px
- [ ] Persist the FRC events snapshot across restarts (before C/D)
- [x] Rebased onto #9: the star and waitlist sit alongside the 🏁 line
- [ ] C: auto-priority (#9 has landed; do it after persistence)
- [ ] D: bigger allowance, once #10 lands

## Findings / gotchas

- **Visual check recipe** (no Slack, no FIRST credentials): build with
  `SKIP_ENV_VALIDATION=1 DATA_DIR=.tmp/build-data npm run build`, then run
  `node node_modules/next/dist/bin/next start` with `NODE_ENV=test` (loads `.env.test`), a scratch
  `DATA_DIR`, and `NODE_OPTIONS=--import file:///…/seed.mjs` seeding `globalThis.__frcEvents`.
  Mint a session cookie as in `weather-sparkline.md`. `npx next start` hung without output in the
  background on Windows; calling Next's bin with `node` directly worked.
- **Reservation slot keys are `10:00am` style** (`hourToTimeSlot`), not `10:00`. Seeded
  reservations with the wrong form silently don't show.
- `#7`'s open question (is a regional's `start` the Wednesday load-in?) only shifts the countdown
  by a day here; the window is wide enough not to matter.

## Things not to do

- Don't add a separate booking rule for event teams; feed #9 and #10 instead.
- Don't store the boost on reservations; compute it from current events.
