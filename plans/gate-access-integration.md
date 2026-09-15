# Gate Access Integration (scheduler side)

## Goal

Let practice-field teams open the physical gate during their reserved slot,
without ever handing out the gate-controller API key. The scheduler is the
**source of truth** for who may open what, when. **Gate Manager** (separate
repo) is a stateless thin proxy that asks the scheduler "is this token allowed
to open `gate` right now?" on every interaction and pulses the gate if yes.

Designed generically so future tools (lights, equipment lockers, irrigation)
reuse the same endpoint with a different `tool` identifier.

## Environment / context

- Repo: `C:\Users\camer\git\playgrounds\practice-field-scheduler`
- Branch: `gate-access-integration` (base: `master`)
- Package manager: **npm** (`package-lock.json`). This project is *not* on the
  Bun list — don't "fix" it to Bun.
- Checks: `npm run typecheck`, `npm run test:unit` (vitest), `npm run check`
  (biome + prettier). `npm run check:write` to autofix.
- Counterpart repo: `C:\Users\camer\git\Personal Projects\Gate Manager`
  - Integration contract: `docs/scheduler-integration.md` (already updated to
    describe the implemented scheduler API — keep it in sync).
  - Route that consumes the DM'd link: `route("g/:token", "routes/team-enroll.tsx")`
    in `app/routes.ts`. **Verified present** — the `${GATE_BASE_URL}/g/<token>`
    shape the scheduler DMs is correct.
- Related, being done by a *different* session in a separate worktree:
  `t3code/admin-blackout-days` at
  `C:\Users\camer\.t3\worktrees\practice-field-scheduler\t3code-b9d31dd3`.
  **Do not do blackout-days work in this tree.**

### New env vars

| Var | Purpose | Unset behaviour |
| --- | --- | --- |
| `SCHEDULER_API_KEY` | Shared bearer secret Gate Manager presents | `/api/access/check` returns 503 |
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-`, scope `chat:write`) for DMs | DMs become logged no-ops |
| `GATE_BASE_URL` | Public Gate Manager base, for `${base}/g/<token>` | link omitted from DMs |
| `STRICT_SLACK_NAMES` | `"true"`/`"1"` rejects logins with malformed display names | soft mode: warn only |

## Decisions already made (don't re-ask)

- **Per-user tokens, not per-reservation.** The original Gate Manager brief
  sketched per-reservation tokens; we switched so a user enrolls a browser
  **once per season** and the bookmark keeps working. Time-gating happens
  server-side on every check via live reservation lookup. Per-*team* tokens
  were considered and rejected — one member leaving would force the whole
  team to re-enroll.
- **Admins get no automatic gate access.** Admins manage reservations but
  aren't necessarily the people at the field; they'd get access via team
  membership like anyone else. (`userTeams()` returns `[]` for admins.)
- **Access window** = `slot_start − 30 min` … `slot_end + 6 h`, in the field's
  configured TZ. Constants in `src/server/access.ts`.
- **Every answer is HTTP 200** with a `{valid, reason, …}` envelope; only
  auth/config/transport problems use non-2xx. Matches the Gate Manager brief.
- **Fail-closed is Gate Manager's job**, not ours — we just answer honestly.
- **Slack failures never break login or reservation flows.** All DMs are
  fire-and-forget, logged on failure.
- **Name convention** is `First Last (1234)`, multi-team `First Last (1234, 5678)`,
  plus approved non-team marker `First Last (TSL)` for lab mates (validates,
  but parses to zero teams so it grants no gate access).
- Rollout order: nudge users via the admin audit panel **first**, then flip
  `STRICT_SLACK_NAMES=true`.

## Plan / steps

1. ✅ `/api/access/check` endpoint + bearer auth + zod validation.
2. ✅ Per-user access tokens (issue lazily on login, index by token, scrub the
   dead per-reservation `token` field on load).
3. ✅ Slack client + welcome DM + reservation-reminder DM.
4. ✅ Slack display-name parsing → team auto-assignment; `STRICT_SLACK_NAMES`
   login gate; `/login` bad-name UI with auto-retry on tab refocus.
5. ✅ Admin Slack-name audit panel on `/users` (list + dry-run + DM all).
6. ⬅️ **CURRENT** — Admin token rotation (the one gap the integration doc
   still lists as "on the roadmap", and which the welcome DM already promises
   to users: *"ask an admin to rotate it"*).
7. Remove the `title=` tooltip added in `NameAuditPanel.tsx` (violates the
   no-`title=` rule — invisible on touch).
8. Document the feature + new env vars in the scheduler `README.md`.
9. Commit; keep `Gate Manager/docs/scheduler-integration.md` in sync.

## Findings / gotchas

- **`git status` shows ~75 modified files; only 14 actually differ.** The rest
  is CRLF noise from `core.autocrlf`. Use `git diff --numstat` to see real
  changes. Don't be alarmed, and don't "fix" line endings.
- **`Lock` is not reentrant** — documented in `src/server/util/Lock.ts`.
  Acquiring twice on one path deadlocks. This is why the WIP added `await` to
  the `restrictToTeam` / `restrictToAdmin` / `restrictTimeframe` calls: those
  resolve `this.user` (which may acquire the lock inside `ensureAccessToken` /
  `syncUserFromSession`) **before** the caller takes the lock itself.
  Verified no current cycle: `this.user` is kicked off in the constructor and
  every lock-holding method awaits a restrict\* helper first.
  **Any new code that acquires `changeLock` must not also `await this.user`
  inside the critical section.**
- `git stash create` does **not** capture untracked files. Several key files
  here are untracked (`slack.ts`, `notifications.ts`, `slackName.ts`,
  `NameAuditPanel.tsx`, `routers/slack.ts`, 4 test files) — a safety stash is
  *not* sufficient protection for them. Commit early instead.
- Baseline at takeover: typecheck ✅, 89 unit tests ✅, biome+prettier ✅.

## Progress log

- [x] Read the WIP commit `89578d5` and the uncommitted follow-on work.
- [x] Confirmed the `/g/:token` route exists in Gate Manager — DM'd links resolve.
- [x] Confirmed baseline checks all pass before adding anything.
- [x] Safety snapshot: `stash@{0}` (tracked files only).
- [ ] Admin token rotation (backend + tRPC + UI + tests).
- [ ] Drop the `title=` attribute in `NameAuditPanel`.
- [ ] README section for gate access.
- [ ] Commit.

## Open questions for the user

1. **Should rotating a user's token immediately DM them the new link?**
   Recommendation: **yes** — otherwise the new link is stranded and the old
   bookmark silently dies with no way for the user to recover it.
2. **Should the admin UI ever display a user's gate link?**
   Recommendation: **no** — it's a bearer secret; showing it puts it in
   screenshots/shoulder-surfing range. Rotate-and-DM covers the real need.

## Things not to do

- Don't do blackout-days work in this tree — another session owns that branch
  in its own worktree.
- Don't switch this project to Bun.
- Don't add `title=` attributes anywhere.
- Don't `git checkout --` / `restore` / `reset --hard` to tidy the tree.
