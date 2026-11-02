# Bookings refused from tabs opened before a deploy

## Goal

A user reported on 2026-11-02 at 3:46 AM PST (11:46Z): "having problems with the
field scheduler this morning". Find out what broke, fix it, and make sure it
can't recur for the same reason.

## Environment / context

- Repo: `C:/Users/camer/git/playgrounds/practice-field-scheduler`, `master`.
- npm, not Bun. Checks: `npm run typecheck`, `npm run test:unit`, `npm run check`,
  `npm run build`, `npm run test:e2e`.
- Production: container `practice-field-scheduler` on steamboat, data in
  `/srv/practice-field-scheduler-data`, public through Cloudflare and Caddy.
- `cameron@steamboat` has passwordless `sudo docker`, so `sudo -n docker logs`
  works. The note in `plans/guests-alongside-host-and-notes.md` that Docker logs
  are unreachable only applies to a non-sudo call.
- Deploying is `servers/steamboat/stacks/practice-field-scheduler/pin.json` in
  ops. Needs the user's yes for that specific change.

## Findings

- `2026/errors.txt` has 8 `reservation.add` BAD_REQUEST entries, 3:42:55–3:45:48 AM
  PST (11:42:55–11:45:48Z), all user `7013458d`, Greg Corsetto, team 8048, Mac
  Chrome 154. The last is seconds before the report. ZodError: `extraRobot`
  expected boolean, received undefined.
- `0007567`, deployed 2026-10-30 2:41 PM PDT (21:41Z), made `extraRobot` a
  required field on `reservation.add`. The current client always sends a boolean
  (`wantsExtraRobot` starts `false`, `teamInSlot` is always boolean), and the
  deployed `page-*.js` chunk contains `extraRobot`. A request without it can only
  come from a page loaded before that deploy. Greg last booked 2026-10-29, the
  day before.
- This is the only failure of its kind: no other user has one. Nobody at all has
  booked since `2026-10-30T14:01Z`, which predates the deploy, but multi-day gaps
  are normal here (Oct 19–22 had none), so the new client just hasn't been
  exercised in production yet.
- The site itself is healthy: `/`, `/login`, feeds all 200, container never
  restarted, disk and memory fine.
- **Security, found on the way:** production runs Next.js 15.3.3 and React 19.1.0.
  That is in range for CVE-2025-55182 (React2Shell), unauthenticated RCE, fixed
  in 15.3.6, and the follow-up DoS and source exposure CVEs, fixed in 15.3.8.
  15.3.9 is the newest 15.3 on npm. The log has `Failed to find Server Action
"x"`, `Unexpected end of form`, and `Cannot read properties of undefined
(reading 'aa')`, which look like probes, not proof of a successful attack.
  Checked `docker diff`, `docker top` and the temp directories on 2026-11-02: only
  image cache changed, one `next-server` process, runs as uid 10001, temp empty.
  That rules out an obvious foothold in this container's lifetime, nothing more.
  Earlier containers are gone, and `/data` was not audited.

## Decisions (made without asking; easy to redirect)

- Fix on the server: `extraRobot` defaults to `false`. A reload would fix one
  person, and this also rescues a tab that stays open.
- Patch bump to 15.3.9 as its own commit, not a move to a newer minor.
- General stale-tab detection is out of scope: logged in `ISSUES.md`.

## Progress log

- [x] Diagnose
- [x] Schema default, with a test
- [x] Next.js 15.3.9, with full checks. Typecheck, unit tests, `npm run check`,
      production build and e2e pass.
- [x] Real bookings against that build on scratch data, signed in with a minted
      session, Slack off: no `extraRobot` books; `false` books; a repeat from
      an old client is still refused; `true` adds a second line.
- [x] `ISSUES.md` entries
- [x] Pushed `0700e34`, with the user's yes. Test and Build image passed.
- [x] Deployed 2026-11-02 9:44 AM PST (17:44Z), with the user's yes: ops
      `13b79e4` (pin.json only, from a throwaway worktree), Server Deploys run
      `41493698850` succeeded. The running image is digest `171ad60c…`, revision
      `0700e34`, and the banner says Next.js 15.3.9. `/`, `/login`, auth providers
      and the `all` feed answer 200, and `reservation.add` without a session 401.
- [x] Cause confirmed by the outcome: Greg failed 3 more times, the last at 9:11:59
      AM PST (17:11:59Z), then booked at 9:12:21 AM (17:12:21Z) from the same
      browser, 32 minutes before this fix went live, so only a reload changed. That
      is also the first real booking through the new dialog.
- [x] Other sites: handed to the ops thread "Audit other sites for React2Shell /
      Next.js", `plans/next-react-exposure-audit.md` there.
- [ ] Auto-refresh on a new version, design in the open questions: needs a yes
- [ ] Secret rotation and a `/data` audit: deferred

## Open questions for the user

1. Build auto-refresh? Tabs check the server's build version on focus and every
   few minutes, reload when no dialog is open, and otherwise wait until it closes.
   A rejected submit from an old tab says the page is out of date.
2. Rotate the secrets listed in `ISSUES.md`? The user's answer on 2026-11-02: not
   yet. Don't rotate until they say so.

## Things not to do

- The e2e suite only loads the homepage. It proves nothing about booking.
- Don't deploy or edit the ops pin without a yes for that change.
- Don't add new required input fields to an existing tRPC mutation: open tabs
  keep running the old client after a deploy.
