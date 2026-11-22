# Our teams' FRC events

## Goal

Load the upcoming official FRC events from FIRST's API and show them in the UI. This tracks
GitHub issue #7 ("Load upcoming events from FRC API"). Issue #8 ("Automatically prioritize teams
registered at events") is blocked on #7 and needs to know which of our teams are registered
for which events. So the data is loaded server-side in a form #8 can use directly.

## Decisions (user, 2026-11-21; don't re-ask)

1. **Which events:** only events at least one of _our teams_ is registered for. Our teams are the
   numeric team numbers on enabled user accounts (`knownTeamNumbers()` in `backend.ts`). Events
   our teams don't attend are not shown, even nearby ones.
2. **Off-season events are included**, and treated the same as official events.
3. **Calendar:** a break row between days, before the first day of each weekend our teams
   compete. The user put it as "between Thursday and Friday, or earlier/later if the event is a
   day earlier or later". It lists the teams competing, grouped by event, with links to The Blue
   Alliance and Statbotics. The calendar shows only about a week ahead, so a break appears only
   when an event falls within that window.
4. **`/events` page:** "a kinda calendar view" of a season.
   - It has FRC week rows. Weeks none of our teams attend stay as compact rows, so the page reads
     like a calendar.
   - The Championship is a group of its own, and off-season events are grouped by month.
   - A season picker defaults to the earliest season with any of our events still to come.
   - Finished events stay on the page, dimmed.
5. **Visibility:** logged-in users only, like the calendar.
6. **Source:** only FIRST's FRC Events API v3, through `first-events-api`, with the existing
   `FIRST_API_*` credentials. TBA and Statbotics are plain links (`/event/<season><code>`), never
   called.

## Design

- **`src/server/frcApi.ts`:** the one FRC client, plus the 1 request/second limiter.
  - Team avatars (`teamLogoManager.ts`) and events share both.
  - The limiter's state lives in `globalThis`. The old avatar limiter never wrote back to its
    global, so HMR reset it.
  - Sets a 15s axios timeout. The library exports its axios instance at runtime but not in its
    types.
- **`src/server/util/frcEvents.ts`:** pure helpers, safe on the client.
  - `parseEventListing` normalizes FIRST's records (zod, lenient; bad records are dropped).
    `start`/`end` are the date part of FIRST's local `dateStart`/`dateEnd`, with no time zone
    conversion.
  - Only competition types (Regional, district events) get a `week`. Other types carry a
    `weekNumber` that means something else.
  - `placeEventBreaks` groups overlapping events into one break, placed at the first shown day on
    or after the group's earliest start. An event already under way gets its break at the top.
  - `seasonSchedule` builds the `/events` rows. `defaultSeason` picks the season the page opens on.
  - `eventsByTeam` is the lookup for #8.
- **`src/server/frcEvents.ts`:** fetching and the cache, shaped like `weather.ts`.
  - Each refresh covers this season and the next. A season costs one all-events listing (for the
    week date ranges) plus one listing per team. Every call is rate-limited.
  - Refreshes every 6h on an unref'd timer. Page SSR waits up to 3s for the very first fetch.
    The client re-polls every minute until data arrives, then hourly.
  - **Only 400/404/501 mean "doesn't exist"** (an unpublished season, or a team FIRST doesn't know
    that season).
    - Anything else keeps the previous data: unreachable, 401, 429 or 5xx. A season keeps its
      previous weeks and events, and a team keeps its previous events.
    - If no season can be fetched at all, the refresh throws and the old snapshot stays. Snapshots
      older than 3 days are withheld.
    - This was a real bug during testing: a 401 counted as "season not published" and wiped the
      cache.
  - `getFrcEvents()` returns the snapshot (served as tRPC `frcEvents.list`). `getTeamEvents(from,
until)` is for #8.
- **UI:**
  - `EventBreak.tsx` renders the break, and `EventSummary` (in the same file) is reused by
    `/events`.
  - Styles are in the "FRC events" section of `index.module.css` and in
    `src/app/events/events.module.css`.
  - The header gets an **Events** button.

## Open question

**Does FIRST's `dateStart` for regionals fall on the load-in day (Wednesday)?** If it does, a
regional's break lands before Wednesday, not between Thursday and Friday. This hasn't been
checked against real data: the main checkout has no `.env`, and no credentials were available
while this was built. To check, look at a regional in the server log or on `/events` once it is
deployed with real credentials. If it is the load-in day and the user wants the break before
competition days, offset regionals (types `Regional`, and maybe `DistrictChampionship*`) by a day
in `placeEventBreaks`. Keep `start` as FIRST publishes it.

## Gotchas

- **Plain `tsc --noEmit` can be stale** here (`incremental: true` with an existing
  `tsconfig.tsbuildinfo`). It reported no errors while `page.tsx` was missing a required prop.
  Use `npx tsc --noEmit --incremental false`.
- **Visual checks without credentials:** preload a module that seeds
  `globalThis.__frcEvents = { snapshot, timer }` (`NODE_OPTIONS="--import file:///…/seed.mjs"
npx next start`).
  - The module's HMR guard clears the seeded timer, so a refresh runs anyway. With dummy
    credentials it gets 401 and, after the fix above, keeps the seeded data.
  - For the login, mint a session as described in `weather-sparkline.md`
    (`next-auth.session-token` cookie).
- The `/events` route is dynamic (it reads `searchParams`). Season links are plain `<Link>`s,
  so the page needs no client JS beyond the shared components.
