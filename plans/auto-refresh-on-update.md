# Refresh open tabs when a new version is live

## Goal

The user's call, 2026-11-02: build and release this. A tab left open across a
deploy keeps running the old page, which is how Greg's bookings were refused
(`plans/stale-tab-booking-failure.md`). Open tabs should move to the new version
by themselves, without ever costing anyone what they're typing.

## Environment / context

- Repo: `C:/Users/camer/git/playgrounds/practice-field-scheduler`, `master`.
- npm, not Bun. Checks: `npm run typecheck`, `npm run test:unit`, `npm run check`,
  `SKIP_ENV_VALIDATION=1 npm run test:e2e`.
- The user authorized release: push, then pin the image in ops
  (`servers/steamboat/stacks/practice-field-scheduler/pin.json`).

## Decisions

- Version = `.next/BUILD_ID`, read by the server at runtime. A tab is told its
  version by the root layout, and compares it with `/api/version`.
- Checked on load, on focus, on becoming visible, and every 5 minutes.
- Reload only when nothing would be lost: no dialog holding the update, no request
  in flight, no text field focused. Otherwise keep trying every few seconds.
- A tab reloads at most once for a given version, so a bad comparison can never
  become a reload loop. That guard is the most important line of this feature.
- No banner. Nothing to click.

## Progress log

- [x] Watcher logic, with tests (`src/app/_components/updateChecker.ts`)
- [x] `/api/version`, layout, component
- [x] Holds on the dialogs, on `/users` links shown once, and on confirmations
- [x] Readable message for a rejected out-of-date request
- [x] Real deploy swap, headless, on the standalone server: the booking dialog held
      the reload across a restart on a new build, the typed note survived, the tab
      reloaded once when the dialog closed, didn't loop, and booked afterwards.
- [x] README, typecheck, unit tests, `npm run check`, e2e
- [x] Released 2026-11-02 11:12 AM PST (19:12Z), with the user's yes: `e99092e`
      pushed, Test (unit and e2e) and Build image green, ops `0366f41` (pin.json
      only, from a throwaway worktree), Server Deploys run `41507587713` succeeded.
      The running image is digest `1b1a3393…`, revision `e99092e`. `/api/version`
      through Cloudflare matches the container's `BUILD_ID`, with `no-store`. A
      headless browser on production: 1 load with the real version, exactly 2 when
      told of a newer one, so no loop.

## Findings / gotchas

- `page.clock.install()` has to come before `page.goto`. Installed after, the
  watcher's timers stay on the real clock and a "didn't reload" check proves nothing.
- The standalone server needs `NEXTAUTH_URL` to start with `https://`, or every
  page 500s while `/api/version` still answers.

- CI's `rmSync` cleanup failure in `slackMappingRepair.test.ts` was not fixed by
  `maxRetries` (`7a48f50`, reverted in `e99092e`). rmSync's retry doesn't list the
  directory again, and it blocks the writes it's waiting for. The async `rm` does
  both. That failure also skips e2e in Test, and fails Build image outright.
- This release can't be seen working on a real tab yet: the first real
  version-to-version refresh is the next deploy. Tabs from before this one need
  one manual reload to get the watcher.

## Things not to do

- Don't reload without the once-per-version guard.
- Tabs opened before this ships don't have the watcher, so they stay old until
  someone reloads. New `tRPC` input fields must stay optional regardless.
