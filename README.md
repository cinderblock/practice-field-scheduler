# Practice Field Reservation System

[![Test](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/test.yml/badge.svg)](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/test.yml)
[![Build image](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/build.yml/badge.svg)](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/build.yml)

## Setup

```bash
# Install dependencies
npm install
```

## Development

### Environment Variables

Copy `.env.example` to `.env` and fill in the required environment variables.

Every setting is read at runtime, including the four the browser needs
(`SITE_TITLE`, `TIME_ZONE`, `TIME_SLOT_BORDERS`, `RESERVATION_DAYS`). They are
deliberately **not** `NEXT_PUBLIC_*`, which Next.js would bake into the bundle
at build time: one image is built by CI and then run by whichever deployment ops
points at it. The root layout reads them and hands them to client components
through `AppConfigProvider` (`src/app/_components/AppConfig.tsx`); code that
needs them outside React takes them as arguments.

Use `npx auth secret --raw` to generate a new `AUTH_SECRET`.
See [Auth.js CLI](https://cli.authjs.dev) for more information.

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### HTTPS

Slack requires HTTPS for all OAuth redirects.

Each method below generates a new URL that you can use to access your development server.

Use the URL in these places:

1. OAuth redirect URI in [Slack app settings](https://api.slack.com/apps/A08S73XASQM/oauth)
2. `NEXTAUTH_URL` environment variable (in `.env` or `.env.local`)
3. Browser URL for development

#### ngrok

You can use [ngrok](https://ngrok.com/) to create a secure tunnel to your localhost.

```bash
ngrok http 3000
```

Ngrok will provide you with a public URL.

#### Cloudflare

You can use [Cloudflare](https://dash.cloudflare.com/sign-up) to create a secure tunnel to your localhost.

You'll need to install `cloudflared`.
[Cloudflare's website](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/#latest-release) has the latest release.

##### Create a tunnel

Use [Cloudflare's Zero Trust configuration](https://one.dash.cloudflare.com/YOUR_CLOUDFLARE_ACCOUNT_ID/networks/tunnels/new) to create a tunnel to your localhost.
It will walk you through starting `cloudflared` and then configure the tunnel.
The configuration will allow configuring a tunnel to your `http://localhost:3000`.

You'll also need to connect a Cloudflare "Application" to the tunnel and enable an Access policy and probably use the "BYPASS" option to disable Cloudflare's login wall.

### Test Reports

Test reports are published to the `gh-pages` branch.

The `gh-pages` branch is automatically deployed to [https://cinderblock.github.io/practice-field-scheduler/](https://cinderblock.github.io/practice-field-scheduler/).

### Technology Stack

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## Running the test suite

1. Install dependencies:

```bash
npm ci
```

2. (First time only) download the Chromium engine Playwright will drive:

```bash
# Download just the Chromium binary (≈120&nbsp;MB) instead of all three browsers
npx playwright install --with-deps chromium
```

3. Run all tests and see coverage:

```bash
npm test
```

The `test` script runs unit/integration tests with Vitest first and then the browser E2E tests with Playwright.

### Blackouts (admin)

Admins can close the field from the **Blackouts** page (linked from the calendar header, or at `/blackouts`).

A blackout covers either a single day or an inclusive range of days, and applies either to the whole day or to
one time slot on each day of the range. While a blackout is in effect:

- Teams cannot create a reservation in any slot it covers, and the add button is hidden. A slot blackout
  is marked **Reserved for** with its reason on the slot itself. A whole-day blackout puts a **Field
  closed** chip in the day's header and draws its three slots as one block, with the reason across it.
- Admins are exempt and can still book over a blackout, the same way they bypass the advance-reservation
  window. They keep the add button on a closed slot.
- The blackout appears in the `all` and `site` calendar feeds — whole-day blackouts as all-day events,
  slot blackouts as one timed event per day.

Creating a blackout does **not** cancel reservations that already exist inside it. Any that conflict are
listed back to the admin so the affected teams can be contacted first. Removing the blackout reopens the
slots immediately.

Blackouts, like all scheduling data, are scoped to the current calendar year.

### Weather

Set `WEATHER_LOCATION` to show the forecast under each day of the calendar. Leave it unset and nothing
weather-related appears.

Beneath each time slot, lined up with it, is a sparkline of the temperature (and chance of rain, when
there is any) over that slot's hours. Under that are the temperature at the start and end of every
slot, each slot's chance of rain, and an icon for the conditions over the first and second half of
the slot. Only reservable hours are shown, not the night. Temperatures are shown in °F.

| Variable                  | Default | Meaning                                                                                                                 |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `WEATHER_LOCATION`        | unset   | `latitude,longitude` of the field (exact, and preferred), or a place name / postal code to look up, like `San Jose, CA` |
| `WEATHER_API_KEY`         | unset   | Only needed for [Open-Meteo](https://open-meteo.com)'s commercial tier                                                  |
| `WEATHER_UPDATES_PER_DAY` | `96`    | How often the server refreshes its cached forecast (96 is every 15 minutes)                                             |
| `WEATHER_FORECAST_DAYS`   | `10`    | How many days ahead to fetch, 1–16                                                                                      |

Forecasts come from Open-Meteo, which needs no API key for non-commercial use. Its data is licensed
CC BY 4.0, so the calendar credits it whenever weather is shown. The server logs the resolved place
when it first fetches a forecast; if a place name picks the wrong town, use coordinates instead. If Open-Meteo is
unreachable, the last forecast keeps being shown for up to a day.

### Calendar Feeds (public)

We expose iCalendar (ICS) feeds that you can subscribe to in Google Calendar, Apple Calendar, Outlook, etc.

| Feed                        | ICS URL                  | Google shortcut                                                   |
| --------------------------- | ------------------------ | ----------------------------------------------------------------- |
| All reservations & events   | `/api/calendar/all.ics`  | `https://calendar.google.com/calendar/r?cid=<absolute-URL-above>` |
| Site events & blackouts     | `/api/calendar/site.ics` | same pattern                                                      |
| Single team (replace `123`) | `/api/calendar/123.ics`  | same pattern                                                      |

Examples:

```text
webcal://your.domain.com/api/calendar/all.ics            # Apple / Outlook one-click
https://your.domain.com/api/calendar/all.ics             # Google "From URL"
https://calendar.google.com/calendar/r?cid=https%3A%2F%2Fyour.domain.com%2Fapi%2Fcalendar%2Fall.ics  # Google shortcut
```

### Tool Access (gate)

Teams and mentors can open the practice-field gate without ever seeing the
gate-controller credentials. The scheduler is the **authority** for who may use
what and when; [Gate Manager](https://github.com/cinderblock/gate-manager) is a
stateless proxy that asks on every interaction and pulses the gate if the
answer is yes.

#### Two kinds of link

Both have the shape `${GATE_BASE_URL}/g/<token>`, and both are checked live on
every use, so a stable bookmark is not a standing grant.

| Link         | Who gets one                                         | When it works                                            | Share it?       |
| ------------ | ---------------------------------------------------- | -------------------------------------------------------- | --------------- |
| **Team**     | one per team, sent to every member                   | the team's reserved slots, 20 min before to 60 min after | within the team |
| **Personal** | people an admin has approved for general gate access | any day, within site hours                               | no              |

- **Site hours are 8am–11pm** (field time) and bound _everything_ the scheduler
  issues, team links included. Overnight, only Gate Manager's own registered
  employees can open the gate; that path never asks the scheduler.
- **General gate access is an explicit grant** — except for admins, who hold
  it by being admins. Nobody else has it by default: an admin approves each
  person, which issues their personal link and DMs it right away. Approval is
  refused until the person's Slack names follow the rules below (they're DM'd
  what to fix), so shared or unverified accounts never get approved. The link
  also stops working if the person is disabled or their names stop following
  the rules. TSL staff have their own setup:
  Gate Manager registers them directly, so the scheduler never tells anyone
  to put `(TSL)` in a display name (it accepts one, and gives it no team).
- **Gate links wait on Slack names.** Nobody is sent a link, team or
  personal, until both of their Slack names follow the format (see
  [Slack names](#slack-names)).
- **Team membership comes from the display name's parentheses.** Until
  someone's names have been read from Slack, teams come from their sign-in
  name instead, so booking works without the Web API.
- **Blackouts don't affect personal links** — they only stop bookings.
- **Delivery is one Slack DM** listing whichever links someone hasn't been sent
  yet (a mentor on two teams gets three links in one message), plus a DM when
  a link is replaced, plus the team link alongside each new reservation. Slack
  being down or unconfigured never breaks sign-in or booking; unsent links go
  out at the next sign-in.
- **Links reset each year.** They're stored under `data/<year>/`, so a new
  season starts with fresh links, issued as people sign in.
- Grace periods and site hours are constants in `src/server/access.ts`.

#### Slack names

| Slack field      | Rule                                                         | Example                                    |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------ |
| **Full name**    | just a name: no digits, no parentheses                       | `Jane Doe`                                 |
| **Display name** | a name, then team number(s) or `TSL` in trailing parentheses | `Jane Doe (1234)`, `Jane Doe (1234, 5678)` |

- Names are read from Slack's Web API: for each person at sign-in, and for the
  whole workspace every 10 minutes. Sign in with Slack doesn't carry the
  display name.
- Names that can't be read count as wrong, so links are held until they've
  been checked.
- While a person's names are wrong, their personal link is refused and team
  links aren't DM'd to them. Reservation notices still arrive, without the
  link.
- They get one DM per wrong pair of names saying what to fix, with suggested
  values. Their links arrive within about 10 minutes of the fix.

#### Admin controls

On `/users`, admins get:

- **Slack names** — everyone in the Slack workspace whose names need fixing
  (including people who've never signed in), what's wrong, and suggested
  fixes. **Check now**, and **Preview**/**Send DMs** with personalised
  instructions. Each person's
  row also says when their gate links are on hold, and why.
- **Team gate links** — per-team status, **Reveal link** (to hand a link over
  when Slack isn't reaching someone) and **Rotate** (new link, every old
  bookmark for that team stops working, the team is DM'd the replacement).
- **Per person, under each name** — general gate access status, **Approve
  general gate access** (issues and DMs their personal link), and for approved
  people **Reveal link**, **Replace link** (DMs the new one) and **Revoke
  access** (deletes the link; approving again issues a fresh one).

Approvals, revocations, reveals, rotations and name-fix DM batches are all
written to the audit log.

#### The check endpoint

```http
POST /api/access/check
Authorization: Bearer <SCHEDULER_API_KEY>
Content-Type: application/json

{ "token": "<opaque>", "tool": "gate" }
```

Every decision — allow or deny — is `200` with a
`{ "valid": …, "grant": "team" | "personal", "reason": … }` envelope. Team
successes carry `team` and `reservation_id`; personal successes carry `user`
instead, with `team` and `reservation_id` null. Non-2xx means a config, auth or
transport problem (`401` bad secret, `503` `SCHEDULER_API_KEY` unset, `500`
unexpected); consumers are expected to fail closed on those.

`tool` is currently only `"gate"`; anything else answers `tool_not_authorized`.
The full contract, including every denial reason, lives in
`docs/scheduler-integration.md` in the Gate Manager repo.

#### Required configuration

| Variable            | Purpose                                                              | If unset                         |
| ------------------- | -------------------------------------------------------------------- | -------------------------------- |
| `SCHEDULER_API_KEY` | Shared bearer secret consumers present (≥32 chars)                   | endpoint returns `503`           |
| `SLACK_BOT_TOKEN`   | Slack bot token (`xoxb-…`), bot scopes `chat:write` and `users:read` | no DMs, no name checks, no links |
| `GATE_BASE_URL`     | Public Gate Manager base URL, used to build `${base}/g/<token>`      | link omitted from DMs            |

The bot needs **`users:read`** to read names (`users.info`, `users.list`).
Without it, `/users` says so and nobody's gate links go out. Add the scope in
the Slack app's **OAuth & Permissions**, then reinstall the app. The bot token
normally stays the same; if Slack issues a new one, update
`SLACK_BOT_TOKEN`.

Generate the API key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Deployment

This repo **does not deploy itself.** Pushing `master` builds a container image
and stops there:

```
push master → build.yml on ubuntu-latest
              checks, tests, docker build
              → ghcr.io/cinderblock/practice-field-scheduler:<sha>
```

What actually runs on the server is named in the private ops repo
(`cinderblock/ops`) by an image **digest**, in
`servers/steamboat/stacks/practice-field-scheduler/pin.json`. Only a push to ops
changes it, so shipping is two steps:

1. Push here. The build job's summary prints a ready-to-paste `pin.json`.
2. Paste it into that file in ops and push. Rolling back is reverting that edit.

The runtime composition — ports, volumes, settings and secrets — lives in the
same ops directory, not here. This repo holds no host credentials and has no
self-hosted runner.

Run the image locally with an `.env` file:

```bash
docker build -t pfs .
docker run --rm -p 3000:3000 --env-file .env -e DATA_DIR=/data -v "$PWD/data:/data" pfs
```
