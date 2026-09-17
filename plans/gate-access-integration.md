# Gate Access Integration (scheduler side)

## Goal

Let practice-field teams open the physical gate during their reserved slot,
without ever handing out the gate-controller API key. The scheduler is the
**source of truth** for who may use what, when. **Gate Manager** (separate
repo) is a stateless thin proxy that asks the scheduler "is this token allowed
to open `gate` right now?" on every interaction and pulses the gate if yes.

Designed generically so future tools (bathroom unlock, door locks, music)
reuse the same endpoint with a different `tool` identifier. See
"Home Assistant" below — those future tools all live in HA.

## Environment / context

- Repo: `C:\Users\camer\git\playgrounds\practice-field-scheduler`
- Branch: `gate-access-integration` (base: `master`)
- Package manager: **npm** (`package-lock.json`). This project is _not_ on the
  Bun list — don't "fix" it to Bun.
- Checks: `npm run typecheck`, `npm run test:unit` (vitest), `npm run check`
  (biome + prettier). `npm run check:write` to autofix.
- Counterpart repo: `C:\Users\camer\git\Personal Projects\Gate Manager`
  - Integration contract: `docs/scheduler-integration.md` — **keep in sync.**
  - Consumes the DM'd link at `route("g/:token", "routes/team-enroll.tsx")`.
    **Verified present**, so `${GATE_BASE_URL}/g/<token>` is correct.
  - Gate Manager talks to **pigate** (`GATE_API_BASE_URL=https://pigate.tomsawyerlabs.com`),
    _not_ to Home Assistant. `src/gate-client.ts` → `POST /pulse`.
- Related, owned by a _different_ session in a separate worktree:
  `t3code/admin-blackout-days` at
  `C:\Users\camer\.t3\worktrees\practice-field-scheduler\t3code-b9d31dd3`.
  It has since landed on `master` and was merged into this branch
  (`e82e1ec`). **Still, don't do blackout-days work in this tree.**
- Deploys:
  - Scheduler production: merge to `master`, then `Test`, then `Deploy`
    (self-hosted runner: `/opt/practice-field-scheduler`,
    `practice-field-scheduler.service`).
  - Scheduler staging: any non-`master` push deploys to
    `https://practice-field-scheduler-staging.tomsawyerlabs.com`
    (`/opt/practice-field-scheduler-staging`, exits after 60 minutes).
  - Gate Manager production: push to its `master`.

### New env vars

| Var                  | Purpose                                                    | Unset behaviour                 |
| -------------------- | ---------------------------------------------------------- | ------------------------------- |
| `SCHEDULER_API_KEY`  | Shared bearer secret Gate Manager presents                 | `/api/access/check` returns 503 |
| `SLACK_BOT_TOKEN`    | Bot token (`xoxb-`, scope `chat:write`) for DMs            | DMs become logged no-ops        |
| `GATE_BASE_URL`      | Public Gate Manager base, for `${base}/g/<token>`          | link omitted from DMs           |
| `STRICT_SLACK_NAMES` | `"true"`/`"1"` rejects logins with malformed display names | soft mode: warn only            |

## Decisions already made (don't re-ask)

- **Two kinds of link** _(user decision, 2026-09-16 — prompted by mentors who
  belong to two teams)_:
  - **Team link** — one per team, shared among members, works only around
    that team's reservations. _(Per-team replaced an earlier per-user design,
    2026-09-15.)_
  - **Personal link** — one per person, works any day within **site hours**,
    no reservation needed. Not shared.
- **Who gets a personal link: only people an admin has approved for general
  gate access** _(user decision, 2026-09-16: "'Mark as shared account' is
  wrong. It should be the inverse")_. Nobody is approved by default, so
  shared/unverified accounts simply never get approved. On top of approval,
  the account must be enabled and its Slack display name must parse. Admins
  and `(TSL)` lab mates need approval like anyone else.
  - Stored as `UserEntry.generalAccessApproved` (replaced the earlier
    default-allow `personalAccessBlocked` flag, which never shipped).
  - **Approve** issues the link and DMs it immediately (with "you've been
    approved" wording). **Revoke** deletes the link outright, so approving
    again always issues a fresh token.
  - At startup, any personal link whose owner isn't approved (or no longer
    exists) is deleted, so an old token can never be revived by approval.
  - Admin UI wording: "Approve general gate access" / "Revoke access".
- **Site hours 8am–11pm, field time, for ALL scheduler-issued access.** From
  11pm to 8am only Gate Manager's own registered employees (~6 people, a
  separate path that never asks the scheduler) can open the gate. Team windows
  are clamped to site hours too; with today's slots (last one 7–10pm, +60 min)
  the clamp is a no-op, but it keeps the rule true if slot borders move.
- **Blackouts do not affect personal links** — blackouts only stop bookings.
- **Contract change applied in both repos** (user chose this over a
  scheduler-only fudge): successes/denials carry `grant: "team" | "personal"`;
  personal successes have `team: null`, `reservation_id: null`, and a real
  `user`. Gate Manager must be deployed **before** the scheduler — the current
  Gate Manager dereferences `check.team.id` on every success. Do not commit in
  the Gate Manager repo without asking: it has someone else's uncommitted
  deploy-pipeline work.
- **Season rollover is automatic.** Both link stores live in
  `data/<year>/…`, and the server restarts at the year boundary, so a new
  year starts with no links; new ones are issued (and DM'd) as people log in.
  _(Correction: an earlier session built a "stale link, rotate manually" flag
  and described rollover as prompted. That flag could never fire because the
  files are per-year; it has been removed.)_
- **Access window: `slot_start − 20 min` … `slot_end + 60 min`.** _(User
  decision, 2026-09-15.)_ Replaces the earlier 30 min / 6 h asymmetry.
- **Gate only for now.** `bathroom` and friends come later; the endpoint is
  already generic over `tool`.
- **Rotation triggers:** on the team's request, on an admin's request, or at
  season rollover (year change).
- **Rotating DMs the team the new link automatically** — otherwise the new
  link is stranded and the old bookmark dies silently.
- **Admin UI reveals the link on explicit action** (not shown by default) —
  so an admin can hand it over when Slack DMs aren't working for someone.
- **Being an admin grants nothing by itself.** Admins aren't on a team's
  roster (`teams: "admin"`), so they get no team link; they get a personal
  link only once approved, same as everyone.
- **`/users` must work well on a phone** _(user feedback, 2026-09-16: "it
  looks like crap on a phone")_. Under 600px each person is a card, buttons
  are 44px in a two-column grid, and team links are compact rows. Shared
  styles live in `src/app/users/_components/adminUi.module.css`.
- **Every answer is HTTP 200** with a `{valid, reason, …}` envelope; only
  auth/config/transport problems use non-2xx. Matches the Gate Manager brief.
- **Fail-closed is Gate Manager's job**, not ours — we answer honestly.
- **Slack failures never break login or reservation flows.** All DMs are
  fire-and-forget, logged on failure.
- **Name convention** `First Last (1234)`, multi-team `First Last (1234, 5678)`,
  plus approved non-team marker `First Last (TSL)` for lab mates (validates,
  but parses to zero teams so it grants no gate access).
- Rollout order: nudge users via the admin audit panel **first**, then flip
  `STRICT_SLACK_NAMES=true`.

## Home Assistant — forward plan

**Grounding (verified live against the `ha-tsl` instance, 2026-09-15):**

| Thing      | Entities that exist today                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate       | `button.gate_controller_gate_pulse`, `script.gate_open`, `sensor.gate_controller_gate_state`, `binary_sensor.gate_controller_throttled`, plus hold/auto-off automations |
| Bathroom   | `script.bathroom_unlock`, `script.bathroom_unlock_new`, `timer.bathroom_unlock`, `sensor.bathroom_unlock_countdown`, `automation.bathroom_unlock_keep_pressing_kastle`  |
| Door locks | **none yet** — the `lock` domain is empty                                                                                                                               |
| Music      | not yet surveyed; will be `media_player.*`                                                                                                                              |

So the bathroom's "unlock for 2 minutes" already exists in HA as a script +
timer. The gate is the odd one out: it's reachable _both_ via HA and via
pigate directly, and Gate Manager currently uses pigate.

**The architectural call: the scheduler must NOT talk to Home Assistant.**

The scheduler stays a pure **policy authority** — it answers "may this token
use tool X right now?" and nothing else. A separate **executor** owns the
device call. Reasons:

- The scheduler is internet-facing and holds no device credentials today.
  Giving it a long-lived HA token makes it a much more attractive target —
  a scheduler compromise would become a _building_ compromise.
- HA is on the LAN; the scheduler may move to the cloud (the integration
  brief explicitly wants that move to stay free).
- Policy and actuation have different failure modes and different rates of
  change. Adding a music integration shouldn't require a scheduler deploy.
- It keeps the existing fail-closed story intact and unchanged.

**Recommended shape:**

```
  browser → Gate Manager (executor) ──ask──→ Scheduler  (policy: yes/no + window)
                    │
                    ├──→ pigate           (gate pulse, today)
                    └──→ Home Assistant   (bathroom, locks, music — later)
                            POST /api/services/script/bathroom_unlock
```

Gate Manager grows from "gate proxy" into a small **tool broker**: one
`tool` → one HA service call, with its own `HA_BASE_URL` + long-lived token,
staying on the LAN. It already has the session, admin UI, audit log and
fail-closed behaviour that the other tools would otherwise each reinvent.

**What the scheduler needs to change to be ready (not yet done):**

1. Turn `SUPPORTED_TOOLS` (a hard-coded `string[]`) into a small **tool
   catalog**: `{ id, label, windowPolicy }`. Adding `bathroom` becomes a
   catalog entry rather than surgery on the evaluator.
2. Allow **per-tool windows**. The gate reasonably opens 20 min early; a
   bathroom unlock might want a wider window, and music probably wants to
   stop _exactly_ at slot end. The evaluator already computes a window per
   reservation — it needs to take the policy as a parameter.
3. Consider a per-team **tool allow-list** (a team might get gate but not
   music). The denial reason `tool_not_authorized` already exists for this
   and is currently only returned for unknown tool ids.

None of that is needed for gate-only, so it's deliberately deferred — but
the catalog refactor should land _before_ the second tool, not after.

**Rules of engagement for HA itself:** infrastructure is off-limits without
per-change authorization. Reading state to ground a design is fine; creating
or editing automations, scripts, helpers or dashboards is not, absent an
explicit yes for that specific change. If HA work is authorized later,
consult the `home-assistant-best-practices` skill first.

## Plan / steps

1. ✅ `/api/access/check` endpoint + bearer auth + zod validation.
2. ✅ Slack client, DMs, name parsing, `STRICT_SLACK_NAMES`, `/login` bad-name
   UI, admin Slack-name audit panel. _(commit `70299a3`)_
3. ✅ Per-team links, admin reveal/rotate, 20/60 grace. _(commit `5d4c1c1`)_
4. ✅ Personal links + site hours (8am–11pm), `grant` in every response,
   per-person admin controls, one-DM delivery, end-to-end backend test.
   _(commit `b5ed307`, plus a follow-up from the UI pass)_
5. ✅ Gate Manager side: `linkHolder()` / `deniedActor()` in
   `src/scheduler-client.ts` (tolerates responses without `grant`), enroll
   page and main view show the holder, pulses logged as `team` or `personal`,
   contract doc rewritten, 7 new tests. The revoked-personal-link copy and
   the contract doc also describe explicit approval. Committed as one
   commit, Gate Manager `3916779` _(user: "one logical commit per feature
   usually")_, leaving that repo's other uncommitted deploy-pipeline work
   alone. **Pushed and live in production** (Deploy run `35141819045`
   succeeded, 2026-09-16).
6. ✅ General gate access became an explicit admin grant _(commit
   `1358a90`)_, with the startup prune of unapproved links _(`eeb035c`)_.
7. ✅ `/users` reworked for phones _(the people table and per-person
   controls in `1358a90`, the rest in `84123b0`)_.
8. ✅ **Slack name rules** _(user request, 2026-09-16: "check Slack
   member's names and to ensure they all follow a standard format. Names
   should just be names. display names must include team affiliation(s)
   after name in parens. Don't enable gate access links for that user until
   they fix their names.")_ Landed on this branch before the merge ("part of
   this upgrade"). Design in "Slack name rules" below.
   - Name rules, issues and suggested fixes: `src/server/util/slackName.ts`.
   - `users.info` / `users.list`: `src/server/slack.ts`.
   - Backend sync, holds, nudges and admin report: `src/server/backend.ts`,
     "Slack names" section.
   - Admin "Slack names" panel, per-person "Gate links on hold", login copy.
   - README, ops plan (`users:read`), tests (306), browser check.
   - **Needs `users:read` on the bot token** before any gate link goes out
     in production.
   - Gate Manager copy and contract doc updated to match, as Gate Manager
     `d9afa7e`. **Committed, not pushed**: pushing its `master` deploys
     production, so it needs the user's go-ahead. It's wording only, so it
     can ship any time.
9. Ship, in this order, each push only with the user's go-ahead (pushes
   deploy). The user approved steps 1–2 on 2026-09-16.
   1. ✅ Push Gate Manager `master`. Its `Deploy` workflow builds, tests and
      deploys **production** on steamboat on every push to `master`.
   2. ✅ Push the scheduler branch. Any non-`master` push deploys
      **staging**. First merged `master` in (`e82e1ec`, see Findings),
      then pushed. CI `Test` passed. Staging is up at
      `https://practice-field-scheduler-staging.tomsawyerlabs.com`.
   3. ⬅️ **NEXT, blocked on the user:** server settings, **set before the
      merge**. Staging answers `/api/access/check` with 503
      "SCHEDULER_API_KEY unset".
      - **Ops now manages the scheduler's deployed env** (user,
        2026-09-16: "now OPS repo manages deployed env of dependency apps
        (like the scheduler). plan to add whatever you need to OPS repo's
        deploy of the sceduler").
      - The ops plan is `plans/practice-field-scheduler-ops-managed.md` in
        `cinderblock/ops`. It's owned by session `t3code-2ac884c3-4d`,
        which implements it in its own ops worktree.
      - **This session owns that plan's "Gate access settings" section**,
        which holds everything the scheduler needs:
        - production-only secrets `SCHEDULER_API_KEY` (must equal Gate
          Manager's) and `SLACK_BOT_TOKEN` (`xoxb-…`, bot scopes
          `chat:write` **and `users:read`**, see step 8);
        - `GATE_BASE_URL=https://gate.tomsawyerlabs.com` in the shared
          `common.env`;
        - `STRICT_SLACK_NAMES` left unset.
      - The two secrets are **required** in the render. Set them in the
        ops `steamboat` environment before the render lists them. Their
        names there are prefixed (user, 2026-09-16):
        `PRACTICE_FIELD_SCHEDULER_API_KEY` and
        `PRACTICE_FIELD_SCHEDULER_SLACK_BOT_TOKEN`.
      - **The user makes the Slack bot token** (scope, App Home Messages
        tab, reinstall, `gh secret set`).
      - The settings ship in ops' stage 1 (env and unit), ahead of runner
        adoption.
      - **Still needs the user's yes:** copying `SCHEDULER_API_KEY` from
        Gate Manager's `gate.env` on steamboat into
        `PRACTICE_FIELD_SCHEDULER_API_KEY`, never printed.

   4. Merge the scheduler branch to `master`. Production deploys after the
      `Test` workflow passes. Until then, production has no
      `/api/access/check` (404), so every gate link shows "Service
      unavailable". That's expected; nothing regressed.
   5. Approve the people who should have general access. Nobody has it
      until then.
   6. Drive a real link through `/g/:token` on a phone, in and out of site
      hours.

10. Later: tool catalog refactor before a second tool (see Home Assistant).

## Slack name rules (step 8 design)

**Root problem found first:** the scheduler has never seen anyone's Slack
display name.

- `src/server/auth/config.ts` reads the claim `https://slack.com/user_name`,
  but Slack's OpenID Connect response has no such claim.
  - Slack's `openid.connect.userInfo` fields: `sub`, `https://slack.com/user_id`,
    `https://slack.com/team_id`, `email`, `email_verified`, `name`, `picture`,
    `given_name`, `family_name`, `locale`, and team and image claims.
  - Checked against docs.slack.dev on 2026-09-16.
- Even if the claim existed, the `jwt` callback reads `profile.displayName`,
  and Auth.js passes the _raw_ provider profile there
  (`@auth/core` 0.37.2, `lib/actions/callback/index.js`), not what
  `profile()` returned.
- So `UserEntry.displayName` is always empty for real users. Every check so
  far ran on the OIDC `name` claim alone.

Only the Web API returns both fields (`profile.real_name`,
`profile.display_name`), through `users.info` / `users.list`, and both need
the bot scope **`users:read`**.

**Rules** (defaults chosen here; the user can change them):

- **Full name** (`real_name`): not empty, and "just a name". That means no
  parentheses or brackets, and no digits.
- **Display name** (`display_name`): `<name> (<affiliations>)`.
  - `<name>` follows the full-name rule.
  - `<affiliations>` is one or more team numbers, comma-separated, or the
    approved marker `TSL`.
  - The two names don't have to match (nicknames are fine).
- Teams still come from the display name, and only when it passes.
  Otherwise the last known teams stay, so booking is unaffected.

**Gate links while names are wrong:**

- The personal link is refused live (`revoked`) and isn't DM'd. Admins
  can't reveal or replace it.
- Team links aren't DM'd to that person at sign-in or on rotation.
- Reservation notices still go out, but without the link, plus a line about
  fixing names.
- Admin reveal of a _team_ link is unaffected; handing it over is a
  deliberate admin act.
- **Names that can't be verified count as wrong.** That covers no bot token,
  no `users:read`, or Slack erroring before a person was ever checked.
  Staging has no bot token, so nobody's links are live there.

**Checks:**

- **At sign-in:** `users.info` for that person, in the background, at most
  once every 5 minutes per person. Every tRPC request resolves the user, so
  this must be throttled. It also dedupes in-flight calls.
- **Workspace-wide:** `users.list` every 10 minutes, plus an admin "Check
  now" button. Skips deleted users, bots, app users and Slackbot.
  - A response without `members` is an error, never "nobody".
  - It doesn't run during `next build`, which loads the real data dir on
    the box, or under Vitest.
- When a signed-in person's names go from wrong to right, their links go
  out right away. A person checked for the first time gets nothing
  automatically, so the first sync after deploy doesn't DM everyone.
- Once a person's names have come from Slack, sign-in no longer overwrites
  them with the OIDC `name`.

**Telling people:**

- **Automatic:** one DM per distinct (full name, display name) pair, and
  only when links would otherwise go out (sign-in or approval). It says what
  is wrong, suggests fixed values, and says where to edit them. Recorded on
  the user, so restarts don't repeat it.
- **Admin, workspace-wide:** the "Slack names" panel lists every member with
  problems, including people who never signed in. It can preview and then
  send personalised DMs.

## Findings / gotchas

- **`git status` shows ~55 "modified" files in the main tree that don't
  actually differ.** `git diff` on them is empty, and `git hash-object`
  equals the `HEAD` blob. Cause: the files are LF on disk (a formatter
  rewrote them), while the index's cached size is from an old CRLF
  checkout. When the cached size is non-zero and differs, git reports
  "modified" **without comparing content**. `git update-index --refresh`
  doesn't clear it. It matters because `git merge` refuses to overwrite
  such files.
  - **Fix, per file, only after checking `git hash-object f` equals
    `git rev-parse HEAD:f`:** `git add -- f`. That stages nothing and
    refreshes the cached size.
  - **Then merge with `git -c core.autocrlf=false …`**, so updated files
    are written as LF like the rest of the tree. The formatters want LF,
    and CRLF files fail `npm run check`.
  - Don't `git checkout --` them (shared-tree rule).
- **A fresh worktree or checkout here is CRLF** (`core.autocrlf=true`), so
  biome/prettier flag every file there. To lint such a tree, export it with
  LF: `git -c core.autocrlf=false checkout-index -a --prefix=<dir>/`.
- **Merging `master` in (2026-09-16, `e82e1ec`)** brought in blackout days
  and the weather forecast. It was done in a temporary worktree, so the
  shared tree was never mid-merge. Conflicts:
  - `backend.ts`: master's blackout code, and one shared `migrated`
    load flag.
  - `test/setup-env.ts`: took master's.
  - `.env.test`: master's FIRST API stubs plus the gate/Slack ones.
  - `env.js`, `.env.example`, `types.ts`, `root.ts`: both sides.

  267 tests and `next build` passed on the result.

- **Staging deploy runs never "finish" quickly.** The last step
  (`npm start`) _is_ the staging server. The job stays in progress until
  staging exits, which it does by itself after 60 minutes
  (`src/app/api/shutdown/route.ts`). Don't `gh run watch` it.
- **`curl -o /dev/null` and `curl -w` fail with error 43 on this machine.**
  Use `curl -s -i … | head -1` for status checks.
- **Typecheck one commit on its own** (when a change is split across
  commits): `git archive HEAD | tar -x -C <tmp>`, junction the repo's
  `node_modules` into it, then run `npx tsc --noEmit` there. When cleaning
  up, **delete the junction on its own first**
  (`[System.IO.Directory]::Delete(<junction>, $false)`). A recursive delete
  of the temp dir could otherwise follow it into the real `node_modules`.
- **Backend state lives in module globals**, so startup behaviour can't be
  tested by "restarting" inside the end-to-end suite. Use a separate test
  file that writes the data files before importing the backend. See
  `test/unit/gateAccessStartup.test.ts`.
- **`Lock` is not reentrant** (see `src/server/util/Lock.ts`). Acquiring twice
  on one path deadlocks. This is why `restrictToTeam` / `restrictToAdmin` /
  `restrictTimeframe` are `await`ed: they resolve `this.user` (which may take
  the lock) **before** the caller takes it. **Any new code that acquires
  `changeLock` must not also `await this.user` inside the critical section.**
- `git stash create` does **not** capture untracked files — a safety stash is
  not sufficient protection when new files are in play. Commit early.
- Gate Manager does _not_ use Home Assistant for the gate; it uses pigate.
- There is no `lock` domain in HA yet — door-lock control is genuinely future
  work, not just un-wired.
- **Gate Manager reads `check.team.id` on every success** (enroll, main view,
  pulse). A scheduler returning `team: null` to the _old_ Gate Manager makes
  personal links fail closed. Hence the deploy order.
- **Link stores are per-year files**, and the server exits when the year
  changes, so rollover is automatic. An earlier "stale link" flag could never
  fire and was removed.
- **The backend is testable end to end**: point `DATA_DIR` at a temp dir
  before importing, stub `fetch` for Slack, and fake only `Date`
  (`vi.useFakeTimers({ toFake: ["Date"] })`) so the change lock still works.
  See `test/unit/gateAccessBackend.test.ts`.
- **Local visual-check recipe** (no real Slack needed): `TEST_AUTH_BYPASS` in
  `.env.test` isn't implemented anywhere.
  1. Seed a temp `DATA_DIR`. Users need `slackNamesSyncedAt` for their
     names to count.
  2. Mint a session with `encode()` from `next-auth/jwt`: secret = the test
     `AUTH_SECRET`, salt = the cookie name `next-auth.session-token`,
     `sub` = a Slack ID mapped in `slack.json`. The seed script must sit in
     the repo root to resolve `next-auth`; delete it afterwards.
  3. Set the session with `document.cookie`.
  4. Run `node node_modules/next/dist/bin/next dev --turbo -p <port>` with
     `.env.test` sourced.
     - **To see Slack-backed UI** (the names panel), fake Slack in-process:
       set `SLACK_BOT_TOKEN` to any `xoxb-…` value, and
       `NODE_OPTIONS=--import=file:///C:/…/mock-slack.mjs`. That script
       swaps `globalThis.fetch` for `https://slack.com/api/*`, answering
       `users.list` / `users.info` from a fixed directory and logging
       `chat.postMessage`. Nothing real is reachable.
     - Otherwise set `SLACK_BOT_TOKEN=""`.
     - Use a literal forward-slash path in `NODE_OPTIONS`; building it with
       `sed` in the Bash tool mangled the backslashes. Through `npx`, a bad
       `NODE_OPTIONS` fails as "Could not determine Node.js install
       directory".
  5. Afterwards, kill the `node.exe` child: stopping the shell task leaves it
     holding the port.
- **Python heredocs in the Bash tool read the script in the Windows code
  page**, so a literal `•` or `—` in a replacement string won't match the
  UTF-8 file. The replacement then fails its "found once" assert, and
  nothing is written. Use the Edit tool for edits containing non-ASCII.
- **The scheduler never saw Slack display names before step 8.** Sign in with
  Slack (OIDC) has no display-name claim. The code read a made-up
  `https://slack.com/user_name` claim through the wrong callback argument.
  Every earlier name check ran on the OIDC `name` claim alone.
- **`Context` resolves the user in its constructor, and `getUser` may now
  wait up to 3 s** for a newcomer's first Slack read, which takes the change
  lock to save. Every `Context` method already resolves the user (via
  `restrictTo*` / `assertAdmin`) before taking the lock, so that can't
  deadlock. Keep it that way in new methods.
- Avatars and team logos render blank locally; that's the fake avatar URLs
  and the FIRST API test credentials, not a bug.
- **Pre-existing issues noticed, not fixed** (outside this task):
  - `initializePart` auto-disables any user whose account was **created**
    more than 18 months ago (not last seen), and disabled users can't sign in.
    Long-standing mentors will lose sign-in _and_ their personal link.
  - `Context.getUsers()` checks `if (!this.isAdmin())` without `await`; the
    Promise is always truthy, so the non-admin filter never runs.
  - `restrictTimeframe` compares `new Date("YYYY-MM-DD")` (UTC midnight) with
    local midnight, so on a server west of UTC a non-admin can't book today.

## Progress log

- [x] Read WIP `89578d5` + the uncommitted follow-on work.
- [x] Confirmed `/g/:token` exists in Gate Manager — DM'd links resolve.
- [x] Committed per-user work (`70299a3`), then per-team (`5d4c1c1`).
- [x] Surveyed Home Assistant for gate / bathroom / lock / music entities.
- [x] Personal links + site hours + contract change (`b5ed307`).
- [x] Verified scheduler: typecheck ✅, biome+prettier ✅, 136 unit tests ✅
      (incl. a 13-step backend end-to-end), and `/users` exercised in a real
      browser at desktop and iPhone 12 Pro widths (reveal, replace, rotate,
      all five personal-link states).
- [x] UI-pass fixes: "DM failed" was shown when Slack simply isn't
      configured (now says why nobody was DM'd); the team-links table
      overflowed on phones (now stacks as cards); long names pushed the users
      table off-screen on phones (cells now wrap).
- [x] Verified Gate Manager: `bun run typecheck` ✅, `bun test src/` 86 ✅.
      Did not run its `build` (it would overwrite another session's local
      `build/`, and no client-side imports were added). Re-verified
      2026-09-16 on top of that repo's newer commits (`804db21`); none of
      them touch the files edited here.
- [x] Explicit "Approve general gate access" model (`1358a90`), plus the
      startup prune of unapproved links (`eeb035c`), which was confirmed to
      fail its test when disabled.
- [x] `/users` phone redesign (`1358a90`, `84123b0`). Checked in a browser at
      iPhone 12 Pro size (no horizontal overflow, 44px targets, card layout,
      reveal/confirm states) and at 1280×900 (table columns sensible, no
      overflow). `1358a90` typechecks on its own.
- [x] Scheduler checks after all of the above: typecheck ✅, biome+prettier
      ✅, 144 unit tests ✅.
- [x] Gate Manager change committed (`3916779`). Before committing,
      re-checked on top of its newer HEAD: typecheck ✅, 86 tests ✅.
- [x] Gate Manager pushed and deployed to production. Landing page is 200;
      a bogus `/g/` token gets 503 because production scheduler has no
      access API yet (expected).
- [x] `master` merged into the branch (`e82e1ec`) and pushed. CI `Test` ✅.
      Staging is serving it. Main tree fast-forwarded (check, typecheck,
      267 tests ✅).
- [x] Slack name rules (step 8). Checks: typecheck ✅, biome+prettier ✅,
      306 unit tests ✅. Four deliberate breaks each failed the end-to-end
      suite. Browser check with a faked Slack at 1280×900 and iPhone 12 Pro:
      the panel lists 4 of 7 members with reasons and suggestions, Preview
      and Send work (personalised DMs), per-person "Gate links on hold" shows,
      and nothing scrolls sideways. Fixed on the way: an empty avatar `src`
      warning. The ops plan's gate section now asks for `users:read`.
- [ ] Staging/production server settings (`SCHEDULER_API_KEY`,
      `SLACK_BOT_TOKEN` with `chat:write` + `users:read`, `GATE_BASE_URL`),
      via the ops plan.
- [ ] Branch merged to `master` (production deploy).
- [ ] Live end-to-end: real link → Gate Manager → scheduler → pigate.

## Open questions for the user

1. **Copying `SCHEDULER_API_KEY`** from Gate Manager's `gate.env` on
   steamboat into the ops secret `PRACTICE_FIELD_SCHEDULER_API_KEY`
   (piped, never printed): may a session do it? Recommendation: yes. It's
   the only way to get the value without rotating the key in both places.
   The other settings questions are answered (step 9.3).
2. **Merging to `master`** (production deploy): when? Recommendation:
   right after the production settings are in place, then approve people
   on `/users`.
3. **People who never sign in to the scheduler get no links.** The scheduler
   only knows people who've signed in once; enumerating the Slack workspace
   would need the `users:read` scope. Recommendation: fine for now, since
   mentors book through the scheduler anyway.
4. **The 18-month auto-disable** (above) will bite long-standing mentors.
   Recommendation: base it on last sign-in rather than creation — a separate
   change.
5. **House/special teams** get a link like any team (ids compared as
   strings). Flag if they shouldn't.
6. **Departing members** keep a shared team link until it's rotated; their
   personal link can be revoked immediately.

## Things not to do

- Don't do blackout-days work in this tree — another session owns that branch.
- Don't bring back default-allow personal links or a "mark as shared
  account" opt-out. General gate access is an explicit grant.
- Don't run `npm run check:write` without checking `git diff --stat`
  afterwards. It formats the whole repo, and this tree is shared.
- Don't hand-edit the scheduler's `.env` on steamboat. Ops renders it now
  (see step 9.3), and ops changes still need the user's per-change yes.
- Don't push plan-only commits to this branch casually. Every push
  redeploys staging.
- Don't give the scheduler Home Assistant credentials (see above).
- Don't change HA automations/scripts without explicit per-change approval.
- Don't switch this project to Bun.
- Don't add `title=` attributes anywhere.
- Don't `git checkout --` / `restore` / `reset --hard` to tidy the tree.
