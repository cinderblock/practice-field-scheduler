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
  **Do not do blackout-days work in this tree.**

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
   alone. **Not pushed yet.**
6. ✅ General gate access became an explicit admin grant _(commit
   `1358a90`)_, with the startup prune of unapproved links _(`eeb035c`)_.
7. ✅ `/users` reworked for phones _(the people table and per-person
   controls in `1358a90`, the rest in `84123b0`)_.
8. ⬅️ **NEXT** — Ship, in this order, each push only with the user's
   go-ahead (pushes deploy):
   1. Push Gate Manager `master`. Its `Deploy` workflow builds, tests and
      deploys **production** on steamboat on every push to `master`.
      Local `master` was `ahead 1` (just `3916779`) when committed.
   2. Push the scheduler branch. Any non-`master` push deploys **staging**.
      Check staging with a real link.
   3. Merge the scheduler branch to `master`. Production deploys after the
      `Test` workflow passes.
   4. Approve the people who should have general access. Nobody has it
      until then.
   5. Drive a real link through `/g/:token` on a phone, in and out of site
      hours.
9. Later: tool catalog refactor before a second tool (see Home Assistant).

## Findings / gotchas

- **`git status` shows ~75 modified files; only a handful actually differ.**
  The rest is CRLF/stat noise from `core.autocrlf` (`git diff --stat` on
  them is empty). Use `git diff --numstat`. Don't "fix" line endings.
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
  `.env.test` isn't implemented anywhere. Instead, seed a temp `DATA_DIR`,
  mint a session with `encode()` from `next-auth/jwt` (secret = the test
  `AUTH_SECRET`, salt = the cookie name `next-auth.session-token`, `sub` = a
  Slack ID mapped in `slack.json`), set it with `document.cookie`, and run
  `next dev` with `.env.test` sourced plus `SLACK_BOT_TOKEN=""`. There's no
  local `.env`, so nothing real is reachable. Kill the `node.exe` child
  afterwards — stopping the shell task leaves it holding the port.
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
- [ ] Gate Manager pushed/deployed (needs the user's go-ahead).
- [ ] Scheduler branch pushed to staging, then merged to `master`.
- [ ] Live end-to-end: real link → Gate Manager → scheduler → pigate.

## Open questions for the user

1. **Deploying** — may I push Gate Manager `master` (production deploy),
   then push the scheduler branch (staging deploy)? Recommendation: yes,
   in that order. The Gate Manager change is backward compatible, so it's
   safe to have live before the scheduler changes.
2. **People who never sign in to the scheduler get no links.** The scheduler
   only knows people who've signed in once; enumerating the Slack workspace
   would need the `users:read` scope. Recommendation: fine for now, since
   mentors book through the scheduler anyway.
3. **The 18-month auto-disable** (above) will bite long-standing mentors.
   Recommendation: base it on last sign-in rather than creation — a separate
   change.
4. **House/special teams** get a link like any team (ids compared as
   strings). Flag if they shouldn't.
5. **Departing members** keep a shared team link until it's rotated; their
   personal link can be revoked immediately.

## Things not to do

- Don't do blackout-days work in this tree — another session owns that branch.
- Don't bring back default-allow personal links or a "mark as shared
  account" opt-out. General gate access is an explicit grant.
- Don't run `npm run check:write` without checking `git diff --stat`
  afterwards. It formats the whole repo, and this tree is shared.
- Don't give the scheduler Home Assistant credentials (see above).
- Don't change HA automations/scripts without explicit per-change approval.
- Don't switch this project to Bun.
- Don't add `title=` attributes anywhere.
- Don't `git checkout --` / `restore` / `reset --hard` to tidy the tree.
