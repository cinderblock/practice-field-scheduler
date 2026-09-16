# Admin blackout days (single day or range)

## Goal

Let admins mark the practice field unavailable for a single day or a range of days
through the UI. A blackout must actually _do_ something: teams cannot book a
blacked-out slot, and the blackout is visible on the calendar and in the iCal feeds.

## Environment / context

- Repo: `practice-field-scheduler` (Next.js 15 App Router, tRPC v11, React 19, TS strict).
- Worktree: `C:\Users\camer\.t3\worktrees\practice-field-scheduler\t3code-b9d31dd3`,
  branch `t3code/admin-blackout-days`.
- Package manager is **npm** (`package-lock.json`, `packageManager: npm@11.4.2`) — not Bun.
  `node_modules` starts empty in a fresh worktree; run `npm ci`.
- Checks: `npm run typecheck`, `npm run check` (biome + prettier), `npm run test:unit`
  (vitest, node env). `test:e2e` is Playwright and needs a running app + real auth, so it
  is not part of the loop here.
- Storage is JSON files under `DATA_DIR/<year>/`, loaded into module-global arrays at
  boot (`src/server/backend.ts`). `blackouts.json` already exists as a concept.
- Everything is year-scoped: `isValidDate()` rejects any date not starting with the
  current year, and the process exits at the year boundary.

## Decisions already made (don't re-ask)

1. **Fork point is `master`** (900ba7d), not `gate-access-integration`. The branch was
   originally cut from the latter; re-pointed with `git reset --keep master`. The dropped
   commit 89578d5 is a self-described superseded WIP and still lives on
   `gate-access-integration`, so nothing was lost.
2. **Extend the existing `Blackout` type rather than adding a parallel concept.**
   `src/types.ts` already had `Blackout`, `backend.ts` already had `addBlackout` /
   `removeBlackout`, and `calendarFeed.ts` already emitted blackout events. There was just
   no router and no UI, and no enforcement.
3. **One record per admin intent, not one per day.** A range is stored as a single
   `Blackout` with `date` (first day) + `endDate` (last day), not expanded into N rows.
   Removing a range is then a single, unambiguous action, and the audit log stays readable.
4. **`slot` becomes optional; absent means the whole day.** "Blackout days" is the headline
   feature, but keeping per-slot blackouts costs nothing and the data model already had it.
5. **Blackouts are keyed by `id`** (like `Holiday`), not by `date`+`slot`. Date+slot cannot
   address a range.
6. **Blackouts block teams; admins are exempt.** Decided by the user on 2026-09-15. I had
   initially made blackouts bind everyone, reasoning that a blackout is a statement about
   physical field availability rather than a fairness policy like the 7-day window. The user
   chose the other way, so `restrictBlackout` now mirrors `restrictTimeframe` and returns
   early for admins. Because the capability has to be reachable, the calendar also passes
   `isAdmin` down and keeps the add button on a closed slot for admins, labelled
   "Admins can still book".
7. **Creating a blackout does not cancel reservations that already exist inside it.**
   Silently destroying teams' bookings is worse than reporting them: `addBlackout` returns
   the conflicting reservations and the admin UI shows them so a human can follow up.
8. **No `title=` tooltips** in new or touched UI (global user rule — invisible on touch).

## Plan / steps

1. [x] Re-fork branch onto `master`.
2. [x] Read the codebase: backend, router pattern, holidays admin page (the UI model to
       copy), `ReservationCalendar`, `calendarFeed`.
3. [x] `src/types.ts` — extend `Blackout` with `id` + `endDate`, make `slot` optional.
4. [x] `src/server/util/timeSlots.ts` — extract slot-string derivation so the admin form and
       the calendar cannot disagree about what a slot string looks like.
5. [x] `src/server/util/blackout.ts` — pure, unit-testable helpers (range iteration,
       coverage test, normalization, display formatting).
6. [x] `src/server/backend.ts` — id backfill for legacy records, range-aware add/remove,
       `getBlackouts()`, conflict reporting, and the `addReservation` enforcement check.
7. [x] `src/server/api/routers/blackout.ts` + register in `root.ts`.
8. [x] `src/app/blackouts/` — admin page + `BlackoutsTable` client component + CSS.
9. [x] `src/app/page.tsx` — nav link, SSR blackouts into the calendar.
10. [x] `src/app/_components/ReservationCalendar.tsx` — render blackouts, suppress the add
        button, show the reason.
11. [x] `src/server/calendarFeed.ts` — expand ranges into the ICS feed.
12. [x] Unit tests for the pure helpers.
13. [x] README / gibon.md updates.
14. [x] Run typecheck, lint, unit tests. Commit.

## Findings / gotchas

- **`Blackout` already existed, half-wired.** `backend.ts` had `addBlackout`/`removeBlackout`
  and `calendarFeed.ts` rendered blackouts, but there was no tRPC router, no UI, and
  critically **no enforcement** — `addReservation` never consulted `blackouts`. So on
  `master` a blackout was pure decoration. Enforcement is the core of this change.
- **Legacy `blackouts.json` records have no `id`.** Backfilled during `initializePart` and
  the file is rewritten once, so ids are stable across restarts. A purely in-memory backfill
  would hand clients ids that go stale on every reboot.
- **`removeBlackout` used to match without checking `deleted`** (`blackouts.find(b => ...)`),
  so re-removing an already-deleted blackout would silently re-stamp it. The id-based
  lookup now filters on `!b.deleted`.
- **`getPublicFeedData()` already filters `!b.deleted`**, so the ICS path only needed range
  expansion, not a deleted check (the existing `if (b.deleted) continue;` is dead but
  harmless — left alone).
- **`hourToTimeSlot()` mishandles fractional slot borders.** `NEXT_PUBLIC_TIME_SLOT_BORDERS`
  is parsed with `parseFloat`, so a border of `-3.5` yields hour `8.5` and the slot string
  `"8.5:00am"`. Pre-existing on `master`; I moved the function verbatim into
  `timeSlots.ts` **without fixing it**, because changing the slot string format would
  orphan every existing reservation whose `slot` was written under the old format. Noted
  here as a separate bug worth its own change.
- **`isValidDate()` is year-locked**, so a blackout range can never exceed the current
  calendar year. That is the natural cap on range length; no extra limit needed.
- Client components already import from `~/server/util/*` (e.g. `RenderTime`,
  `UsersTable`), so putting shared pure helpers there matches existing convention despite
  the `server/` path.
- **Every permission check in `backend.ts` was called without `await`.** All ten sites —
  `restrictToTeam`, `restrictTimeframe`, `restrictToAdmin` — are `async`, so
  `this.restrictToAdmin(...)` produced a floating promise: the guard rejected into an
  unhandled rejection while the operation carried on and succeeded. Access control across
  reservations, blackouts, site events and holidays was effectively a no-op on `master`.
  Fixed all ten, because admin-only blackout management is meaningless otherwise. The two
  "refuses to let a non-admin ..." cases in `blackoutEnforcement.test.ts` fail without the
  fix, so they pin it down.
- **Vitest never loaded `.env.test`.** The file was committed but nothing read it: Vitest
  does not populate `process.env` from dotenv files, and `src/env.js` validates at import
  time, so importing any module that reaches `~/env` threw "Invalid environment variables".
  `.env.test` was also missing two required vars (`FIRST_API_USERNAME`,
  `FIRST_API_AUTH_TOKEN`), so it could not have validated even if loaded. Added both plus
  `test/setup-env.ts` (wired into `setupFiles`), which loads the file while letting real
  environment values win.
- **The worktree is checked out CRLF** (`core.autocrlf=true`, no `.gitattributes`), so
  `npm run check` reports a format error on essentially every file in the repo, untouched
  ones included. Not caused by this change and not worth a repo-wide reformat here. Verify
  with `npx biome check <specific files>` instead. Because git normalises on commit, writing
  LF into a file that was CRLF produces no spurious diff — confirmed via `git diff --stat`.
- `next build` needs env vars present; copying `.env.test` to `.env.local` works for a local
  build check. Delete it afterwards, and delete the `test/data` directory the build creates
  (gitignored, but still clutter).

## Progress log

- [x] Branch re-forked onto `master`, WIP commit confirmed safe on `gate-access-integration`.
- [x] Codebase read and design settled.
- [x] Types, pure helpers, backend, router.
- [x] Admin UI, calendar rendering, ICS feed.
- [x] Tests: 55 new across four files — `blackout` (33 pure), `timeSlots` (8),
      `blackoutEnforcement` (9, drives the real backend), `blackoutMigration` (5, legacy records).
      Whole suite: 62 passing.
- [x] Docs: README admin section, gibon.md feature/type/tree entries.
- [x] `tsc --noEmit` clean, biome clean on every touched file, prettier clean on docs,
      `next build` succeeds with `/blackouts` routed.

## Open questions for the user

Both resolved on 2026-09-15:

1. ~~Should admins be able to book over a blackout?~~ **Yes** — see decision 6.
2. ~~Should creating a blackout offer to cancel conflicting reservations?~~ **No**, report
   only — see decision 7, unchanged.

Not pushed: the user asked to keep the branch local for now.

## Things not to do

- Don't expand a date range into one record per day — removal and the audit log both get ugly.
- Don't "fix" `hourToTimeSlot`'s fractional-hour handling as part of this change; it
  rewrites slot strings and orphans existing reservation data.
- Don't add `title=` attributes to any UI.
- Don't auto-cancel reservations when a blackout is created.
