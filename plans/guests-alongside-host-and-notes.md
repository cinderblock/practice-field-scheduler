# One line per click, extra robots, strict team numbers, notes

## Goal

Requested 2026-10-29, following `plans/team-booking-and-guests.md`:

1. A team having a slot and bringing guests (or more robots) is the common case
   and must not be refused. Every team gets its own line item.
2. Team numbers must be valid positive numbers.
3. Any entry can carry a short note.

## Environment / context

- Repo: `C:/Users/camer/git/playgrounds/practice-field-scheduler`, `master`.
- npm, not Bun. Checks: `npm run typecheck`, `npm run test:unit`, `npm run check`.
- `src/server/websocket.ts` is a stub: other browsers don't get live updates, so
  a new line or note reaches them on their next load, same as before.
- Browser check recipe: `plans/gate-access-integration.md` (scratch `DATA_DIR`,
  minted session).

## Decisions already made (don't re-ask)

- **One + click, one line.** The user's call, 2026-10-30. A second team or a
  second robot is a second click. An all-in-one booking was built first and
  thrown away before it was pushed: it needed guest rows, a "book my team too"
  checkbox, a batch API and grouped DMs to save a click or two.
- **Extra robot** is a checkbox on a line. Only these lines may repeat a team in
  a slot. If the team already has the slot, the dialog ticks it and locks it, so
  a second click just works. Ticking it on a first line is allowed.

Made without asking; easy to redirect:

- A team has one ordinary line per slot, as itself or as someone's guest, and
  can't be its own guest.
- **Team number** = digits only, no leading zero, 1 to 100,000 (the limit the
  avatar route already uses). New bookings and field reports only; stored data
  is untouched.
- **Notes**: single-line, 100 characters. Set in the dialog, or added/changed
  later with the ✎ on the pill by whoever may cancel the line.

## Findings / gotchas

- The server never refused "host has a slot, add a guest": the duplicate check
  is per team, so `1234` then `5678 guest of 1234` already worked as two clicks.
  What it did refuse was a second line for the same team, hence Extra robot.
- The duplicate check ran outside the lock and compared with `===`, so number
  `1234` and string `"1234"` didn't match. Now under the lock, with `sameTeam`.
- `reservation.notes` was always `""` from the UI, so it was never user text
  before. It now reaches a Slack DM, which needs `&<>` escaped, and the ICS
  feed, which ical-generator escapes itself. Feeds need no sign-in, so a note is
  as public as the reservation.
- Two lines for one team in one slot would have produced duplicate ICS UIDs, so
  an extra robot's line is its own event, keyed by reservation id.
- Locally the browser console shows 400s from `/_next/image`: the avatar route
  answers 404 with the test FIRST credentials. Not a bug in this work.
- The Add dialog can't scroll. It fits on a phone now, but keep that in mind if
  it grows.

## Progress log

- [x] Shared rules (`src/server/util/reservation.ts`)
- [x] Backend: `extraRobot`, duplicate check under the lock,
      `setReservationNotes`
- [x] Router: strict team schema, notes schema, `setNotes` (schemas in
      `src/server/api/schemas/reservation.ts`, so tests can load them without
      next-auth)
- [x] Dialog: Extra robot, note, inline problems
- [x] Pill: extra robot and note lines, ✎ editor
- [x] DM and calendar feed carry both; feed keeps every distinct note of a
      merged block
- [x] Field report team uses the same rule
- [x] Unit tests, including `reservationRules.test.ts`
- [x] README
- [x] Browser check
- [x] Typecheck, `npm run check`, unit tests, production build, e2e
- [ ] Push and deploy (needs the user's yes)

## Things not to do

- Don't bring back one-go booking with several teams.
- Don't add `title=` attributes.
- Don't run `npm run check:write` without checking `git diff --stat` after.
- Don't switch this project to Bun.
