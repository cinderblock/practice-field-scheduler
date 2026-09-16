# Weather on the calendar

## Goal

Show the expected weather for each calendar day, covering only the hours teams can reserve
(first slot start to last slot end), not the night.

The request evolved during the session on 2026-09-16:

1. **Initial ask:** a simplified view like the holidays, adding no height (or one row at
   most): a daily temperature sparkline, maybe with a second line for rain.
2. **After seeing a small inline sparkline in the day header:** the sparkline must line up
   with the slots' times and stretch across the whole width. Adding a line of height at the
   bottom of each day is acceptable.
3. **After seeing that:** call out the temperature at the start, the end, and every border
   between slots. No daily range (it "looks terrible"). Show each period's chance of rain,
   centered between its pair of temperatures. Add a sun/cloud/rain icon between each
   temperature and rain figure, so two per period.

What shipped matches (3): under each slot, a sparkline (temperature line, chance-of-rain line
with a light fill) and a caption line: `88° ☀️ 9% 🌤️ 90° ☁️ 1% ☁️ 82° 🌙 0% 🌙 81°`.

Tracks GitHub issue #15 ("Weather Support"). The three open PRs from that issue (#16
`copilot/fix-15`, #17 `gibon/Fix-15`, #18 `gibon/15`) were read for ideas only; none of
their code is reused.

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\practice-field-scheduler\t3code-2ac884c3`, branch
  `t3code/add-weather-sparkline`, forked from `master` at a74a028.
- Next.js 15 App Router, tRPC v11, React 19, zod 3, TS strict. **npm**, not Bun
  (`package-lock.json`, `packageManager: npm@11.4.2`).
- Checks: `npm run typecheck`, `npx biome check <files>` + `npx prettier --check <files>`
  (see the CRLF gotcha below), `npm run test:unit`. `test:e2e` needs a running app and is not
  part of the loop. `npx next build` works with a `.env.local` (see below).
- Slot layout comes from `NEXT_PUBLIC_TIME_SLOT_BORDERS` (hours relative to noon, default
  `-2, 4, 7, 10` = 10am–4pm, 4–7pm, 7–10pm) and `NEXT_PUBLIC_TIME_ZONE`.
- **How production runs** (checked 2026-09-16). This repo is public, so server specifics
  (host, ports, accounts, permissions, runner names) are deliberately left out; they belong
  in the user's private infrastructure repo.
  - The app is served from `/opt/practice-field-scheduler` by `npm start`. Next.js loads the
    `.env` in that directory itself, at build and at start. It is maintained by hand on the
    server; no IaC manages it.
  - `.github/workflows/deploy.yml` deploys `master` on a self-hosted runner: `git reset --hard`
    (which leaves the untracked `.env` alone), `npm ci`, `npm run build`, restart. A new env
    value takes effect at that restart.
  - Any push to another branch deploys staging from `/opt/practice-field-scheduler-staging`,
    whose `.env` already had a `WEATHER_LOCATION` (a town name) from testing the old PRs.
  - **Production `WEATHER_LOCATION` was set on 2026-09-16** to the field's exact coordinates,
    supplied by the user, with their explicit go-ahead.
- Server changes need the user's explicit yes for each specific change.
- Issue #15 spec (user-written): optional city env, geocode to lat/long, Open-Meteo (no key
  needed) with an optional key env, server refreshes X times/day (env, default 96) for the
  next ~10 days (env, default 10), cache for clients, tRPC API used for SSR and client
  updates, Celsius internally and a `Temperature` component with a `celsius` prop that
  displays Fahrenheit.

## Decisions already made (don't re-ask)

1. **Placement: a cell under each slot, inside the slot grid.** `DayWeather` renders its cells
   with no wrapper so they become a second row of `.timeSlotRow`; every cell is exactly as
   wide as its slot at any width (measured: 0px misalignment at 1280, 700 and 390 wide). The
   day header is exactly as on `master`.
2. **Time axis: linear within each slot**, across the slot's full width, the same mapping as
   the slot's progress line. The current-time marker in the sparkline **is** a
   `.timeSlotProgress` div, updated once a second like the slot's, so the header, slot and
   forecast lines coincide exactly (measured identical to 0.001px at 1280, 700 and 390 wide).
   Lines carry on flat across the gap to the next slot (a gap is one instant), clipped to
   exactly the gap with `clip-path: inset()` using a negative right inset.
3. **Captions, one line under the sparkline:** temperature at every slot border (inner ones
   centered on the gap, outer ones flush with the slot edges), each slot's chance of rain
   centered between its two temperatures, and a condition icon at each quarter point.
   Positions are computed in CSS from two anchors per cell (`--start`, `--end`).
4. **Chance of rain for a period = the highest hourly chance among hours overlapping it.**
   Open-Meteo's `precipitation_probability` is for the _preceding_ hour, so the sample at a
   slot's start belongs to the previous slot. For drawing, each value is plotted mid-hour.
   Below 10% the figure is shown but dimmed.
5. **Condition icons from WMO `weather_code`** (instantaneous), one per half-slot: any
   significant weather (code ≥ 45) wins, highest code first (WMO's own convention); otherwise
   the mean cloud cover code. `is_day` (nearest sample to the half's midpoint) picks night
   icons (🌙) so evening slots don't show a sun.
6. **Temperature scale** is the day's min..max within reservation hours, padded to a minimum
   5°C span so a 1° wiggle doesn't look dramatic. Rain uses a fixed 0–100% scale.
7. **Open-Meteo via plain `fetch` + zod**, not the `openmeteo` npm SDK (a FlatBuffers decoder:
   overkill for a few hundred numbers). No new dependency.
8. **`WEATHER_LOCATION` accepts `lat,lon` or a place name / postal code.** Coordinates skip
   geocoding; names are geocoded once (Open-Meteo honours `Springfield, IL` qualifiers).
   Unset = feature off, nothing renders.
9. **Env names:** `WEATHER_LOCATION`, `WEATHER_API_KEY` (switches to the `customer-*` hosts),
   `WEATHER_UPDATES_PER_DAY` (default 96), `WEATHER_FORECAST_DAYS` (default 10, 1–16).
10. **Server cache in `globalThis`** (HMR-safe, like `backend.ts`), refreshed on an unref'd
    timer started by the first request; page SSR waits up to 3s for the very first fetch. A
    failed refresh keeps the last forecast; one older than 24h is withheld. Refresh interval
    has a 1-minute floor. The API key is never logged (and is scrubbed from wrapped errors).
11. **Only samples near reservation hours are sent to the client** (±1h, for interpolation).
12. **Attribution:** Open-Meteo data is CC BY 4.0, so "Weather for <place>, from
    Open-Meteo.com" shows under the calendar when weather is enabled.
13. **No `title=` tooltips** (global rule). Each cell is `role="img"` with a full spoken
    summary, e.g. "Forecast for 10am to 4pm: 85°F at 10am, 86°F at 4pm, overcast, 25% chance
    of rain"; the visible captions are `aria-hidden`.
14. **Temperatures display in °F** via `src/app/_components/Temperature.tsx`, the one place
    that knows about units; captions use the short `85°` form.

## Plan / steps

1. [x] Read codebase, old branches, issue #15; probe Open-Meteo responses.
2. [x] Env vars (`src/env.js`, `.env.example`), types (`WeatherSample`, `WeatherForecast`).
3. [x] `src/server/util/weather.ts`: pure helpers (location parsing, conversion,
       reservation-hour filter, per-slot summary, WMO codes, sparkline geometry).
       `createDateFromDateStringHour` moved from `ReservationCalendar.tsx` into
       `src/server/util/timeSlots.ts`, plus `getSlotWindows` and `formatHour`.
4. [x] `src/server/weather.ts`: Open-Meteo client and cache/refresh service; tRPC
       `weather.forecast`; SSR in `src/app/page.tsx`.
5. [x] UI: `DayWeather.tsx`, `Temperature.tsx`, CSS section "Weather" in `index.module.css`,
       attribution.
6. [x] Unit tests: `test/unit/weather.test.ts`, `test/unit/weatherApi.test.ts`, additions to
       `test/unit/timeSlots.test.ts`. 130 tests passing.
7. [x] Browser checks at 1280 / 700 / 390 (iPhone 13) wide, dark and light, closed day.
8. [x] `next build` passes.
9. [x] README and `gibon.md`.
10. [x] Preview cleanup: dev server stopped, `.env.local` and scratch data deleted,
        workspace-contention marker removed.
11. [x] Final checks and commit.
12. [x] Production `WEATHER_LOCATION` set (coordinates from the user). Coordinates now display
        like `37.3394° N, 121.8950° W` in the credit line rather than as raw decimals.
13. [ ] **(current)** Push to `master` (user: "just publish to master"), watch Test and Deploy,
        confirm the forecast loads in production.

## Findings / gotchas

- **Open-Meteo shapes** (`timeformat=unixtime`, `timezone=America/Los_Angeles`):
  `hourly.time` is epoch seconds from local midnight today, 24 per day. No nulls seen.
  `temperature_2m`, `weather_code`, `is_day` are instantaneous; `precipitation_probability`
  is for the preceding hour (confirmed in the docs).
- **Errors** come back as HTTP 400 `{"error": true, "reason": "..."}`. A geocoding miss is
  HTTP 200 with no `results` key. Keyed hosts are `customer-api.open-meteo.com` and
  `customer-geocoding-api.open-meteo.com`.
- **Old branches had real bugs** worth not repeating: `copilot/fix-15` bucketed hours by
  `toISOString()` (UTC dates) while requesting local-time data, and indexed
  `hourlyTemperatures[hour]` assuming 24 entries per local day (wrong on DST days).
- **The worktree is checked out CRLF** (`core.autocrlf=true`), so `npm run check` flags
  every file. Check specific files instead, after normalizing them to LF (git stores LF, so
  that makes no diff). **Never run `biome check --write` on a whole directory here**: it
  rewrote 54 unrelated files to LF. They had no content change (`git diff` empty) and were
  converted back to CRLF.
- **The Bash tool mangles heredocs containing apostrophes** (`unexpected EOF`). Write file
  content with the Write tool instead.
- **Visual check without Slack:** `TEST_AUTH_BYPASS` in `.env.test` isn't implemented
  anywhere. Instead: `.env.local` = `.env.test` with `DATA_DIR` pointed at a scratch dir and
  `WEATHER_LOCATION="Houston, TX"` (mixed dry/rainy days), then mint a session with
  `@auth/core/jwt` `encode({token: {sub, name, email}, secret: AUTH_SECRET, salt:
"next-auth.session-token"})` and set it as the `next-auth.session-token` cookie. The first
  user becomes admin. Playwright (installed Chromium) was more reliable for screenshots than
  the T3 preview panel, whose snapshots started timing out.
- **Stopping `npx next dev` via TaskStop leaves the child `node start-server.js` listening.**
  Find it by port and stop it.
- **A Houston forecast on LA time** shows moons from ~5:30pm, because `is_day` is local to the
  forecast location. Not a bug; a real deployment has matching location and time zone.
- **Header-placement attempts (superseded):** a `flex; space-between` header made the inline
  sparkline drift sideways day to day, and a `1fr auto 1fr` grid made dates wrap at ~700px
  wide. Both moot now that the header is untouched.
- **The slots' mobile `margin-right: 0.25rem` doesn't narrow them** (they're also
  `width: 100%`, so it just overflows). Copying it onto the weather cells misaligned them by
  4px, so the cells don't copy it.
- **Corner labels over the sparkline collided with the line** (in Houston the line is high at
  10am), which is part of why captions got their own line.
- **Current-time line was 1px off (user report):** the slot's line is a 2px `div` whose _left
  edge_ is at the progress point; the first sparkline marker was an SVG line _centered_ on
  it, and only refreshed every 30s. Fixed by rendering the marker as the same
  `.timeSlotProgress` element with the same 1s cadence, rather than imitating it.
- **White cloud and moon emoji vanish in light mode**; a 1px dark `drop-shadow` fixes it.
- **Pre-existing, not touched:** at phone width the page overflows horizontally by a few px
  (identical with weather hidden), and a long holiday name wraps the date onto two lines.
- **Dev-only:** after changing the sample shape, the in-memory cache from before the reload
  lacks the new fields until the next refresh (triggered by the next request).

## Progress log

- [x] Research and design.
- [x] First version (inline header sparkline), reviewed by the user, revised twice.
- [x] Final version implemented, unit tested, typecheck clean, biome/prettier clean on
      touched files, `next build` passes, visually verified.
- [x] Fixed the 1px current-time line offset the user reported; verified by measurement.
- [x] Production `WEATHER_LOCATION` set with the user's go-ahead.
- [ ] Pushed to `master` and deployed.

## Open questions for the user

1. The weather row adds 46px per day on desktop and 36px on a phone (sparkline plus captions).
   The captions needed their own line to stay legible; say if a denser layout is wanted.
2. Issue #15 and its three stale PRs (#16–#18) are still open; closing them is the user's call.

## Things not to do

- Don't change anything on the server without the user's explicit yes for that change.
- Don't commit server specifics or the field's coordinates to this public repo.
- Don't render weather through the night; only reservation hours.
- Don't show a daily temperature range (user: "looks terrible").
- Don't overlay captions on the sparkline; they collide with the line.
- Don't switch the repo to Bun as a side effect.
- Don't run formatters with `--write` across whole directories in this checkout.
