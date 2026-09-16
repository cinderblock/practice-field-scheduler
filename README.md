# Practice Field Reservation System

[![Test](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/test.yml/badge.svg)](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/test.yml)
[![Deploy](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/deploy.yml/badge.svg)](https://github.com/cinderblock/practice-field-scheduler/actions/workflows/deploy.yml)

## Setup

```bash
# Install dependencies
npm install
```

## Development

### Environment Variables

Copy `.env.example` to `.env` and fill in the required environment variables.

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

- Teams cannot create a reservation in any slot it covers. The slot shows as **Closed** on the calendar,
  with the reason if one was given, and the add button is hidden.
- Admins are exempt and can still book over a blackout, the same way they bypass the advance-reservation
  window. They keep the add button on a closed slot, labelled so it's clear why it's there.
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
