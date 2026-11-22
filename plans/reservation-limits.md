# Weekly limits: 1 priority and 7 bookings per team per week (#10)

## Goal

Issue #10: "There should be a limit to priority reservations per team per time
period." Built on #9 (priority sorts first, top `SLOT_CAPACITY` get the field,
the rest are waitlisted; see `plans/reservation-priority-waitlist.md`).

Requested 2026-11-21. #8 (more precedence for teams with an upcoming FRC event)
will add a bonus through `priorityAllowance`.

## Environment / context

- Branch `t3/plan-reservation-limits`, one commit on `origin/master` after #9
  landed there as `bc663fb` (PR #58, a squash). It was first built on #9's local
  `4b19669` and moved with `git rebase --onto origin/master 4b19669`, which
  went through cleanly.
- Booking rules live in `src/server/backend.ts` (`Context.addReservation` and the
  `restrict*` guards). The ordering is in `src/server/util/reservation.ts`, which
  is shared with the calendar.

## Decisions already made (don't re-ask)

User, 2026-11-21/22:

- **Week** = Monday–Sunday in `TIME_ZONE`. A line belongs to the week of its
  slot's date, not the day it was booked.
- **Charged team** = the host on a guest line, otherwise the team
  (`accessTeamFor`, compared with `sameTeam`).
- **Priority: 1 per charged team per week.** A priority line counts **until its
  day passes**, waitlisted or not. After that it counts only if it had a place
  (`gotPriorityPlace`). Over the limit, the booking is **refused**. Admins are
  exempt.
- **Total: 7 lines per charged team per week, never refused.** Lines past the
  cap are booked but **sort last** in their slot: priority, then ordinary, then
  over the cap. They get the field only if the slot has room.
  - Counts: ordinary, priority and guest lines (guests charged to the host).
  - Doesn't count: extra-robot lines, cancelled lines, days before today. The
    allowance frees up as the week goes on.
  - The team's earliest 7 by booking time stay normal, priority lines first, so
    booking a priority line pushes the team's newest ordinary line over the cap.
  - Admin-booked lines count like any other. Nothing is refused, so there's no
    exemption to give.
- Limits are code constants (`PRIORITY_PER_WEEK`, `LINES_PER_WEEK`), like
  `AdvancedReservationDays`. No env var or admin page.
- Over-cap status is derived, never stored, the same way as #9's standing. It
  goes to browsers as `overWeeklyCap: true` on copies only.

## Design

- `src/server/util/slotTime.ts`: `fieldWeekStart(date)`.
- `src/server/util/weeklyLimits.ts` (server only; it needs `sameTeam` from
  `access.ts`): the constants, `priorityAllowance` (#8's hook),
  `overWeeklyCap`, `withWeeklyCap`, `standingsBySlot`, `priorityUsage`,
  `weeklyUsage`.
- `src/server/util/reservation.ts`: `orderSlot` sorts by tier: priority (0),
  ordinary (1), `overWeeklyCap` (2).
- `backend.ts`:
  - `restrictPriority` inside `changeLock` in `addReservation`.
  - Add and remove diff the standings of the whole week, not just the slot, so a
    line in another slot pushed over the cap (or brought back under) gets #9's
    bumped / promoted DM, with the reason.
  - Reservations sent to browsers (`listReservations`, add and setNotes
    responses, feeds) carry the derived flag.
  - `weeklyUsage` for the Add dialog.
- UI: an "Over weekly limit" tag on the pill. The Add dialog shows priority left
  this week and the booking count, and disables Prioritize when it's used up
  (except for admins). Other days' lists refetch after an add or remove, since
  the cap reaches across slots.

## Progress log

- [x] Helpers and unit tests (`test/unit/weeklyLimits.test.ts`, `fieldWeekStart`
      in `slotTime.test.ts`)
- [x] Backend guard, week-wide diffs, wire flag, `weeklyUsage`; end to end in
      `gateAccessBackend.test.ts`: a second priority is refused with the message,
      next week's and ordinary ones aren't, cancelling gives it back, admins are
      exempt. A priority booking pushes the team's 7th line past the cap, onto
      the waitlist, with a DM. A 9th booking is flagged and its DM says why.
      `reservations.json` never holds the flag. Cancelling brings it back, with
      a DM.
- [x] Notices (weekly-cap reasons on bumped / promoted / new-booking DMs)
- [x] UI: "Over weekly limit" tag, dialog hints, Prioritize disabled (struck
      through) once used, other days refetched after add / remove
- [x] README "Weekly limits"
- [x] Typecheck, `npm run check`, 510 unit tests, production build
- [x] Browser check, headless Playwright against a scratch `DATA_DIR` (seed and
      shot scripts in the session scratchpad), 1280 and 390 wide. Team 2468's
      over-cap Thursday line sorts under four later bookings, waitlisted and
      tagged. Friday's dialog says the priority is used (Tue 7pm), Prioritize is
      disabled, and "booking #9 this week, past its 7". This week's dialog says
      "1 priority booking left" and "Booking 1 of 7". No horizontal scroll.
- [x] Rebased onto `origin/master` after #9 merged (`bc663fb`). Typecheck,
      check, 550 unit tests and the build all pass there.
- [x] Told the #9 and #8 threads about the refined rule and the hooks;
      commented the final rule on #10 (issuecomment-7076608192)
- [x] Pushed; PR #59 (https://github.com/cinderblock/practice-field-scheduler/pull/59)

## Findings / gotchas

- `gateAccessBackend.test.ts` runs as one sequence (see #9's plan). Run the whole
  file. Its clock ends on Monday 2026-05-25, so the limit tests use that week, and
  June weeks booked by the admin.
- The build needs env: `SKIP_ENV_VALIDATION=1` alone fails collecting page data
  (no `DATA_DIR`). Source `.env.test` and point `DATA_DIR` at a scratch dir.
- The dev server rejects a non-https `NEXTAUTH_URL`. Keep `.env.test`'s value. The
  minted cookie still works on `http://localhost`.
- `next dev` writes an untracked `AGENTS.md` in the repo root; delete it.

## Things not to do

- Don't store `overWeeklyCap` on reservations, or write it to `reservations.json`.
- Don't refuse a booking for being over the total cap.
- Don't add `title=` attributes.
