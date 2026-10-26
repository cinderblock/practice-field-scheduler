# Field issue reports (safety / repair / not reset) with snapshots

## Goal

Let a mentor at the practice field report a problem with it, from the calendar, in a few
taps: pick what kind of problem it is, add a note, attach photos from their phone, and have
the scheduler grab a frame from the shop's cameras at the same moment. Admins get a viewer
for the resulting incident log, where they can see the photos and mark a report resolved.

Asked for by the user on 2026-10-26: "a way to report issues with the field. maybe a button
next to the add reservation button? mentor selects one of: safety issue / repair needed /
repair made / field not reset / other. use/take/store snapshots to help document. from users
device and from the shop's cameras. we'll also need a viewer for the incident log."

## Environment / context

- Repo: `C:\Users\camer\git\playgrounds\practice-field-scheduler`, branch `master`, shared
  working tree. At the start of this task every tracked file showed as modified, but only
  because of LF→CRLF line endings (`git diff --ignore-cr-at-eol` is empty). Stage only the
  files this task creates or edits.
- Next.js 15 App Router, tRPC v11, React 19, TypeScript strict, CSS modules. **npm**, not
  Bun (`package-lock.json`, `packageManager: npm@11.4.2`). Node 24 locally; the image runs
  Node 22.
- Checks: `npm run typecheck`, `npm run check` (biome + prettier; `npm run check:write` to
  fix), `npm run test:unit` (vitest). `test:e2e` needs a running app with real Slack auth, so
  it is not part of the loop.
- Storage is JSON arrays under `DATA_DIR/<year>/`, loaded into module globals at boot in
  `src/server/backend.ts`. Audit trail is `DATA_DIR/<year>/logs.txt`, one JSON object per
  line, read by `/logs`.
- Production: `practice-field-scheduler.tomsawyerlabs.com`, container on `steamboat`,
  `DATA_DIR` bind-mounted from `/srv/practice-field-scheduler-data`. Deployment settings live
  in `cinderblock/ops` at `servers/steamboat/stacks/practice-field-scheduler/compose.yml`.
  Nothing there is touched by this task; see "Open questions".
- The shop's cameras are UniFi Protect cameras (NVR at `10.255.0.2:7447`). **The field
  view the user wants is not a single camera.** It is `all-field`, a composite built by
  `restitch`/`stitchd` on `sentinel` (ops: `servers/sentinel/stacks/restitch/config.yaml`):
  `the-field` (a crop of the five ceiling "Bay" cameras, flipped 180°, right-trimmed)
  stacked over the **Field Centered** turret, 3686×3290, cropped to the field. It is what
  pFMS records matches from (`http://pfms.tsl/admin` → VIDEO → stream `all-field` =
  `rtsp://sentinel.tsl:8554/all-field`) and what the public stream shows
  (`https://stream.tomsawyerlabs.com/all-field/`, HLS; LAN HLS on `sentinel.tsl:9000`).
  Restitch offers RTSP/HLS/WebRTC only, no JPEG snapshot endpoint.
- Home Assistant (`https://homeassistant.tomsawyerlabs.com`, IPv4 `10.255.0.9`, HA 2026.9.3)
  has no camera for `all-field` yet. It does have three **generic** cameras on restitch's
  RTSP outputs (`camera.field_centered_restitch` = `rtsp://sentinel.tsl:8554/raw/field-centered`,
  plus doorbell and foyer), which is exactly the pattern needed: a generic camera with only
  a `stream_source` gets its stills from the stream via ffmpeg, and HA serves them at
  `GET {HA_URL}/api/camera_proxy/{entity_id}` with a long-lived access token as a bearer.
  The single turret `camera.g5_turret_ultra_high_resolution_channel` was my first guess and
  is wrong (user, 2026-10-26).

## Decisions already made (don't re-ask)

1. **The report button lives in each time slot, beside the add button, on blocks that have
   started.** That is what the user suggested, and it gives every report a date and slot
   for free (the practice block it is about). It is the mirror image of the add button:
   add is on blocks that haven't ended, report on blocks that have begun (current and
   past), so the two meet on the current block. Confirmed with the user on 2026-10-26
   ("Is the add report button only on now and past blocks?"); the first version showed it
   on future blocks too.
2. **Any signed-in user can file a report; only admins can read the log.** Everyone signed
   in is a mentor or team member. The log holds camera frames of the shop and people's
   photos, so it is admin-only like `/logs`, `/users` and `/blackouts`. A reporter sees
   their own report confirmed in the dialog and that is it.
3. **Nine kinds, fixed:** `safety`, `repair_needed`, `repair_made`, `not_reset`,
   `game_pieces`, `left_behind`, `gate_access`, `pfms`, `other`, stored as those identifiers
   and labelled in the UI, "other" always last. The user picked the last four on 2026-10-26
   ("do them all"): game pieces walk off and "repair" is the wrong word; lost-and-found with
   a photo so the owner can be found on Slack; gate or access problems tie into the gate
   manager; and a pFMS kind that steers people to pFMS's own support widget (which sends
   logs and a screenshot) but accepts the report here just in case. Notes are required for
   `pfms` and `other`, where a picture can't tell the story.
4. **Two snapshot sources, both best-effort and independent.** Device photos are chosen or
   taken with `<input type="file" accept="image/*" capture="environment">`, downscaled in
   the browser (longest side 1600 px, JPEG) so a phone's 12 MP originals never hit the
   server, and uploaded as multipart to a route handler. Camera frames are fetched by the
   server from Home Assistant when the report is filed. A camera being unreachable, or an
   upload failing, never loses the report itself.
5. **Creation is two steps: file the report over tRPC, then upload photos to it.** The
   report (and the camera capture) succeed or fail on their own, and a failed upload can be
   retried against the same report. One giant multipart request would make the report hang
   on the slowest part of it.
6. **Files live next to the data, under `DATA_DIR/<year>/issues/<issueId>/`.** Same bind
   mount, same per-season layout as everything else; the record in `issues.json` names the
   files. Snapshots are served only through an admin-gated route, never from `public/`.
7. **Cameras are configured, not discovered.** `FIELD_CAMERAS` is an optional runtime
   setting listing `Label=<source>` pairs. Unset, the feature works without camera frames and
   the dialog does not mention them.
8. **A camera source is a URL or a Home Assistant entity.** Settled on 2026-10-26 when the
   user offered to add a JPEG still export to restitch. A `http(s)://` source is fetched
   as-is and must answer with a JPEG, PNG or WebP; a `camera.<entity>` source goes through
   HA's camera proxy and needs `HOME_ASSISTANT_URL` and `HOME_ASSISTANT_TOKEN`. The composite
   field view is reached directly from restitch (`http://sentinel.tsl:9000/api/still/all-field`),
   so no HA camera has to be created for it.
9. **No `title=` tooltips** in new UI (global user rule).
10. **Package manager stays npm** for this repo (its own convention; it is not on the Bun
    list).

## Plan / steps

1. [x] Read the codebase: backend/data layer, blackout router + admin page (UI model),
       logs page (viewer model), calendar slot + add modal, team-avatar route (binary
       route model), env/config plumbing, tests.
2. [x] Confirm what "the shop's cameras" are and how to pull a still (HA camera proxy).
3. [x] Write this plan.
4. [x] `src/types.ts`: `FieldIssue`, `FieldIssueKind`, `FieldIssueSnapshot`, `AddFieldIssueArgs`.
5. [x] `src/server/util/fieldIssue.ts`: pure helpers (kind labels, `FIELD_CAMERAS`
       parsing, snapshot filename rules, image sniffing, limits) with unit tests.
6. [x] `src/env.js` + `.env.example`: the three optional camera settings.
7. [x] `src/server/cameras.ts`: fetch a frame from each configured camera via HA, with a
       10 s timeout, never throwing. `fetch` is injectable for tests.
8. [x] `src/server/backend.ts`: `fieldIssues` store + `issues.json`, `addFieldIssue`,
       `attachFieldIssuePhoto`, `listFieldIssues`, `setFieldIssueResolved`,
       `removeFieldIssue`, `readFieldIssueSnapshot`, `InvalidRequestError`, log entries
       (`fieldIssueAdd/Photo/Resolve/Reopen/Remove`), startup warning for a half-configured
       camera setup.
9. [x] `src/server/api/routers/fieldIssue.ts` (`add`, `list`, `setResolved`, `remove`) +
       registered in `root.ts` as `fieldIssue`.
10. [x] `src/app/api/issues/[id]/photos/route.ts` (multipart upload, one photo per request)
        and `src/app/api/issues/[id]/snapshots/[file]/route.ts` (admin-only download).
        Both build their `Context` through the new `src/server/requestContext.ts`.
11. [x] `AppConfig.fieldCameras` (labels only, and only when all three settings are set);
        `layout.tsx` supplies them.
12. [x] `src/app/_components/ReportFieldIssue.tsx` (+ `.module.css`): the `!` button and
        the dialog, wired into `TimeSlot` beside the add button; browser-side downscale to
        1600 px JPEG; per-photo upload with retry; positioning rules in `index.module.css`
        (`.reportIssueBtn`, `.reportIssueBtnAlone`).
13. [x] `src/app/issues/` admin page + `IssuesList` client component + CSS (open/resolved
        tabs, kind filter, thumbnails with a lightbox, resolve with note, reopen, remove);
        **Field Issues** link on the calendar header.
14. [x] Tests: `fieldIssue.test.ts` (helpers), `cameras.test.ts` (HA capture),
        `fieldIssueBackend.test.ts` (real backend on a scratch `DATA_DIR`, with a stubbed
        HA camera proxy), `fieldIssueRoutes.test.ts` (route handlers).
15. [x] README section, `gibon.md` feature line, `/logs` shows `kind`, `snapshots` and
        `cameraErrors`.
16. [x] typecheck, `npm run check`, 381 unit tests passing, production build; commit.

## Findings / gotchas

- The add button (`.addReservationBtn`) is absolutely positioned at the bottom centre of
  the slot and revealed on hover; `.timeSlotOver .addReservationBtn { display: none }` hides
  it once the slot has ended. The report button needs its own class so it can stay visible
  on ended slots and sit to the right of the add button without moving it.
- `TimeSlot` already owns an Escape-key handler for the add modal; a second dialog in the
  same component needs its own, or they fight. The report dialog is its own component with
  its own handler.
- `Context` resolves the user lazily (`this.user` promise); `getContext()` gives
  `{ timestamp, userId, userAgent, ip }` for log lines. Every mutating method takes
  `changeLock`, appends a log entry, writes the JSON file, and releases under
  `ContinueOnError`.
- tRPC here uses superjson, so `Date` survives the wire; `Buffer` does not belong in it.
  Binary goes through route handlers (`src/app/api/team-avatar/.../route.ts` is the model).
- Route handlers get the session from `auth()` and build a `Context` by hand, exactly as
  the pages do (`src/app/blackouts/page.tsx`).
- `initializePart` only knows arrays and dispatches on identity (`getFilePath`,
  `getArrayName`); a new store needs entries in both, plus date revival for its records.
- Home Assistant's camera proxy returns the camera's native JPEG (UniFi high-resolution
  channel is 4K, roughly 500 KB to 1 MB per frame). Stored as-is; downscaling on the
  server would need `sharp`, which is not a direct dependency.
- **Backend tests find people by email, not session id.** A test session's `user.id` is
  not a Slack id, so `getUser` resolves it by email (`<id>@example.test`); the seeded
  `users.json` entries must carry exactly that email or every session lands on a fresh
  non-admin user. First run of the backend test failed on this with "Only admins can…".
- Biome's `useKeyWithClickEvents` rejects a click-to-close backdrop `div`. The report
  dialog closes with Cancel/Close/Escape only (as the add dialog does); the lightbox's
  backdrop is a full-size `<button>` so it stays clickable and keyboard-reachable.
- Biome also flags a `vh` + `dvh` fallback pair as a duplicate property; only `dvh` is
  used (supported by every current browser).
- **The UI was not exercised in a browser.** Sign-in is Slack OAuth with no test bypass
  and there is no local `.env`, so the calendar can't be reached locally without a tunnel
  and the real Slack app. Coverage is typecheck, lint, the four test files and a full
  `next build`. First real look will be on staging/production.

## Progress log

- [x] 2026-10-26 (morning, PDT): exploration, camera identification, plan written.
- [x] Types, helpers, env, camera client.
- [x] Backend store, router, routes.
- [x] Calendar button + dialog.
- [x] Admin viewer.
- [x] Tests, docs; typecheck + check + unit suite green; build run.
- [x] Committed as `8e22acb`.
- [x] 2026-10-26: user corrected the camera (it's the `all-field` composite, not the
      turret); report button limited to blocks that have started.
- [x] 2026-10-26: `FIELD_CAMERAS` accepts URL sources; README/.env.example/tests updated.
- [x] 2026-10-26: restitch `f86818a` merged to master, built by CI, pinned on sentinel
      (ops `8536ed7`), verified: `http://sentinel.tsl:9000/api/still/all-field` is the
      3686×3290 composite in 0.13 s.
- [x] 2026-10-26: scheduler master pushed (`478f324`), image built, pinned in ops `981a277`
      with the `FIELD_CAMERAS` line in the same commit (both authorized), live on steamboat
      by 1:20 PM PDT (20:20Z). On the way: CI's `ubuntu-latest` had moved to 26.04 and
      Playwright has no Chromium for it (`e8e698e` pins the test job to 24.04), and two
      reports filed in one millisecond tied on `created` (`478f324` breaks the tie toward
      the later one).
- [x] 2026-10-26: first look at the dialog on the live site, in the user's Chrome: all nine
      kinds render, the camera checkbox reads "Include a frame from the shop camera
      (Field)", so the config reached the container. No report filed (that is the user's
      call on production), so the capture itself is unproven until the first real report.
- [x] 2026-10-26: four more kinds (`game_pieces`, `left_behind`, `gate_access`, `pfms`), the
      user's pick; sample notes moved into the kind table (`d4f848f`). 383 tests green.

## Open questions for the user

1. **Getting a still of `all-field` to the scheduler.** Decided 2026-10-26: restitch grows
   a full-size still export (branch `field-still-export`, worktree
   `C:/Users/camer/git/restitch-still-export`, plan `plans/field-still-export.md` there) and
   the scheduler fetches it directly. Once that restitch build is pinned on sentinel, the only
   ops change is one line in the scheduler's compose file:
   `FIELD_CAMERAS: Field=http://sentinel.tsl:9000/api/still/all-field`. No HA camera, no
   token. The user asked on 2026-10-26 whether this goes in "our private image/deploy/compose
   file": yes, `servers/steamboat/stacks/practice-field-scheduler/compose.yml` in
   `cinderblock/ops`, never the app repo. The line is written, uncommitted, in the ops
   worktree `C:/Users/camer/git/ops-restitch-pin` and waits on the per-change yes. It needs a
   scheduler image with the feature pushed and pinned first (the running pin is `8a32c5f`).
   The HA route (a generic camera on `rtsp://sentinel.tsl:8554/all-field`) still works if
   ever wanted.
2. **Should safety reports DM the admins on Slack?** The Slack DM plumbing exists
   (`sendDirectMessage`); a safety report that nobody sees until someone opens `/issues` is
   weaker than one that pings. Not built; easy follow-up if wanted.
3. **Should open "repair needed" reports show on the calendar for everyone?** Teams might
   like to know the field has a known problem before they drive over. Not built.

## Things not to do

- Don't put snapshots under `public/` or serve them unauthenticated.
- Don't send photos through tRPC as base64; use the multipart route.
- Don't make the report button hide on ended slots like the add button does.
- Don't edit the ops repo or Home Assistant for this; configuration is the user's call.
- Don't point `FIELD_CAMERAS` at the single turret camera; the user wants the composite.
- Don't stage the line-ending-only changes that litter `git status`.
