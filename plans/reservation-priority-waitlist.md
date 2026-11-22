# Priority sorts first, top N get the field, the rest are waitlisted (#9)

## Goal

Give the `priority` flag a meaning. It had been stored since the first
backend commit (`e1bc0b9`, 2025-05) with no rule reading it, and the
"Prioritize" checkbox did nothing.

Requested 2026-11-21. #10 (limits) is being designed in another thread; #8
(automatic precedence for teams with events) builds on this.

## Decisions already made (don't re-ask)

- A slot's lines are ordered **priority first, then booking order**. The **top
  N get the field**; the rest are **waitlisted**. Nobody is refused.
- **N = 4**, counting **lines**: guests and extra robots each take a place.
- A late priority line **can bump** an ordinary one onto the waitlist **any
  time before the slot starts**. The bumped team is DM'd; a team that moves
  back up is DM'd too.
- **Waitlist is advisory**: gate access is unchanged.
- **Same 7-day window** for priority lines.
- **The limit is #10's job** ("about 1 priority per team per week; it doesn't
  count if you didn't get a place"). This change only exposes
  `gotPriorityPlace`.
- Existing stored `priority: true` rows: the user said not to worry about them.

## Design

- `src/server/util/reservation.ts`: `SLOT_CAPACITY`, `orderSlot`,
  `slotStandings`, `gotPriorityPlace`, `standingChanges`. Shared with the
  calendar, so the client and server order lines the same way. The order is
  derived, never stored.
- `backend.ts`: `addReservation` and `removeReservation` diff the slot's
  standings around the change, under the lock. After the lock is released,
  `fireStandingDms` sends "bumped" / "promoted" DMs to the line's access team
  (the host's, for a guest), skipping the person who made the change. Nothing
  is sent once the slot has started. The booking DM marks priority and a
  waitlisted start. The log entry gets `priority: true`.
- `calendarFeed.ts`: "(waitlisted)" label, judged against every line in the
  slot. A waitlisted line doesn't merge into its team's block.
- UI: pills sorted. Priority lines get a ★; waitlisted pills are grey under a
  "Waitlist" divider. The form's line previews in place. The dialog says
  "N of 4 places taken", "you'd be waitlisted (#k)", or "priority puts you
  ahead of team X".

## Progress log

- [x] Helpers + unit tests (`reservationRules.test.ts`)
- [x] Backend diffs and DMs; end-to-end DM tests in
      `gateAccessBackend.test.ts` (bump, promote, nothing after the start;
      mutation-checked the start cutoff)
- [x] Notices (`notifications.test.ts`), feed label (`calendarFeed.test.ts`)
- [x] Calendar UI and dialog note
- [x] README "Priority and the waitlist"
- [x] Typecheck, `npm run check`, 489 unit tests, production build
- [x] Browser check (scratch `DATA_DIR`, minted member session, 1280 and
      iPhone 12 Pro): a priority line seeded late sorts first, with lines 5+
      under the divider. In a full slot the dialog says "you'd be waitlisted
      (#5)"; ticking Prioritize says "ahead of team 2004" and previews the
      order. Booking stored `priority: true` and logged it. Cancelling it
      moved 2004 back up. The `all` feed labels 1004/1005 "(waitlisted)". No
      horizontal scroll at phone width.
- `next dev` writes an untracked `AGENTS.md` in the repo root; delete it.
- [ ] Note on #10 about `gotPriorityPlace`, once the user approves the wording

## Findings / gotchas

- `gateAccessBackend.test.ts` runs as one sequence. Filtering it with `-t`
  makes the first person to sign in an admin, so run the whole file.
- An earlier test there books 1234 on 2026-05-28 10:00am, so the priority
  tests use the 29th.
- `src/server/websocket.ts` is still a stub: other browsers see a new order on
  their next load.

## Things not to do

- Don't store the standing on reservations.
- Don't refuse a booking because a slot is full.
- Don't add `title=` attributes.
- Don't run `npm run check:write` without checking `git diff --stat` after.
