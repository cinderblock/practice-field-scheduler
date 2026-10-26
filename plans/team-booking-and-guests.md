# Book only for your own team, plus guest ("buddy") reservations

## Goal

1. A non-admin may only book (and cancel) field time for a team their Slack
   display name says they belong to. This is the rule `EnforceTeamMembership`
   has carried since September, switched off because user records had no teams.
2. A new kind of reservation: a **guest** (buddy) reservation. A mentor books a
   slot for a visiting team that isn't in the scheduler. It is its own
   reservation under the guest team's number, linked to the mentor's team (the
   **host**). The host team's access is what covers it.

Requested 2026-10-26.

## Environment / context

- Repo: `C:/Users/camer/git/playgrounds/practice-field-scheduler`, `master`.
  Shared working tree: ~45 files show as modified but are LF-vs-CRLF noise
  (`git diff` is empty for them). Stage only this task's files.
- npm, not Bun (project rule). Checks: `npm run typecheck`,
  `npm run test:unit`, `npm run check`.
- Teams come from the Slack display name's parentheses, `Jane Doe (1234)`,
  parsed by `src/server/util/slackName.ts` and stored on `UserEntry.teams` by
  the name sync in `src/server/backend.ts` (`applyTeams`). Bot token has
  `users:read` + `users:read.email`; all users were matched to Slack on
  2026-09-19, 11 of 36 with teams.
- Gate Manager contract: `C:/Users/camer/git/Personal Projects/Gate Manager/docs/scheduler-integration.md`.

## Decisions already made (don't re-ask)

- **Enforce now, with a fix-it message.** Someone with no team in their display
  name is refused with a message saying how to fix their Slack name. The Add
  dialog only offers the person's own team(s), plus the guest option. Admins
  stay exempt from the rule.
- **A guest reservation is its own reservation**: `team` = the guest team,
  `host` = the mentor's team. It is linked to the host team, which holds the
  access.

## Design

- `Reservation.host?: TeamFull`. Set only on guest reservations.
- Booking: non-admin, no host -> `team` must be one of theirs. Non-admin with a
  host -> `host` must be one of theirs; `team` is any team number other than
  the host. Admins may set any team and any host.
- Cancelling: members of either the team or the host.
- Gate access: a reservation's access belongs to its host when it has one,
  otherwise to its team. So the host's team link opens the gate during a guest
  block, and the guest team's own link (if it has one) does not. The access
  check's `team` field stays "the link's team", so the contract's shape doesn't
  change.
- DMs: a guest reservation notifies the host team, with the host's link.
- Calendar feeds: the host's team feed includes the guest blocks it hosts;
  summaries read "Team 5678 (guest of 1234)".
- UI: the pill shows the guest team with a "guest of 1234" line. The dialog
  offers own team(s) (fixed text or a picker) and a "Guest team" checkbox with
  a guest number input; admins type any team and an optional host. No teams ->
  an explanation instead of a form.
- Copy that says "booking works either way" (Slack name notice, README) is no
  longer true and gets rewritten.

## Progress log

- [x] Backend: `Reservation.host`, router schema + `bookableTeams` query,
      `restrictToTeams` (book: own team, or host as own team; cancel: either
      side), `EnforceTeamMembership = true`, refusal text with the fix,
      `host` in log entries
- [x] Access windows (`accessTeamFor`), reservation DMs to the host, team
      calendar feed includes hosted guests (kept apart from the guest's own
      blocks)
- [x] UI: team picker / fixed team / free text for admins, Guest team
      checkbox + number, "guest of" on the pill, no-team notice with Check
      again, notice footnote rewritten
- [x] Tests: 399 unit tests green. New: team-membership and guest cases in
      `reservationWindow.test.ts`, guest access in `access.test.ts`, guest DM
      in `notifications.test.ts`, new `calendarFeed.test.ts`. Mutation-checked:
      with enforcement off, 7 tests fail.
- [x] Browser check (scratch `DATA_DIR`, minted sessions, recipe in
      `plans/gate-access-integration.md`): two-team mentor gets a picker and
      booked a guest (stored with `host: "1234"`, pill "9999 guest of 1234");
      one-team member sees the team fixed; no-team member sees the
      explanation; admin at phone width gets free text.
- [x] README "Booking: your own team, or a guest"; Gate Manager contract note
      (`e0931f0` in that repo, not pushed)
- [x] Pushed `fa74f29` (user's yes). Image
      `sha256:2eb55e2f3a1498e2dddbecb619b2496e6cb564bb4107efe412e5d4518428973f`.
      Test and lint green; the report upload hit a registry 429 and passed on
      re-run. Gate Manager `e0931f0` pushed too.
- [x] Deployed 2026-10-26 4:54 PM PDT (23:54Z), with the user's yes for the
      pin: ops `eb840df` (pin.json only, committed from a throwaway worktree),
      deploy run `40422738479` "pin verified: fa74f29…". On steamboat the
      container's revision label is `fa74f29`; `/login` 200 directly and
      through Caddy; `/api/access/check` 401 without a key.

## Findings / gotchas

- **Shared accounts can't book any more.** The old test "lets someone with
  wrong Slack names book" used a shared "Robotics Laptop" account with no team
  in its name. Under enforcement it is refused. The fix is the same as for a
  person: display name `Robotics Laptop (1234)`. That is enough to book even
  while the full name is still wrong (gate links still wait on both names).
- As of 2026-09-19 only 11 of 36 users had teams. Everyone else is refused
  until they fix their display name; the dialog and the refusal both say how.
- The dev server's env schema requires an `https://` `NEXTAUTH_URL`; keep
  `.env.test`'s `https://not-used` for local checks.
- Windows `curl` here failed every HTTPS request with "A libcurl function was
  given a bad argument" (status `000`). Check the site from steamboat instead
  (`curl --resolve <host>:443:127.0.0.1`).
- Re-running the screenshot script against the same scratch data needs a new
  guest number each time, or the duplicate check refuses it.

## Open questions for the user

(none. Pushed and deployed with the user's yes; telling the club about the
display-name requirement is the user's call.)

## Things not to do

- Don't run `npm run check:write` without checking `git diff --stat` after; it
  formats the whole shared tree.
- Don't add `title=` attributes.
- Don't switch this project to Bun.
