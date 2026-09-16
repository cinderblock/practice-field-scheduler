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

Teams can open the practice-field gate during their reserved slot without ever
seeing the gate-controller credentials. The scheduler is the **authority** for
who may use what and when; [Gate Manager](https://github.com/cinderblock/gate-manager)
is a stateless proxy that asks on every interaction and pulses the gate if the
answer is yes.

#### How it works

- **One shared link per team.** Each team gets a single URL of the form
  `${GATE_BASE_URL}/g/<token>`, shared among its members. Bookmark it once; it
  works all season. The time-gating happens server-side on every request, so a
  stable link is not a standing grant.
- **Team membership comes from Slack display names** in the form
  `First Last (1234)` (multi-team: `First Last (1234, 5678)`; lab mates who
  aren't on a team: `First Last (TSL)`, which validates but grants no access).
  Membership re-syncs on every login.
- **The access window** is the reserved slot padded by 20 minutes before and
  60 minutes after. Both are constants in `src/server/access.ts`.
- **Delivery is over Slack DM** — on first issue, on rotation, and alongside
  each new reservation for the team. Slack being down or unconfigured never
  breaks login or booking; the failure is logged and the link is picked up on
  the next login.
- **Admins get no access by virtue of being admins** — they get it through team
  membership like anyone else.

#### Admin controls

On `/users`, admins get two panels:

- **Slack-name audit** — lists anyone whose display name doesn't match the
  convention and can DM them all fix-it instructions. Use this before turning
  on `STRICT_SLACK_NAMES`.
- **Team gate links** — per-team link status, **Reveal link** (for handing a
  link over when Slack isn't reaching someone), and **Rotate** (issues a new
  link, invalidates every existing bookmark for that team, and DMs the team the
  replacement). Both reveal and rotate are written to the audit log.

Links issued before the current season are flagged as stale. Rotating is
deliberately a manual click rather than something that happens automatically at
the year boundary, so nobody's bookmark dies unannounced.

#### The check endpoint

```http
POST /api/access/check
Authorization: Bearer <SCHEDULER_API_KEY>
Content-Type: application/json

{ "token": "<opaque>", "tool": "gate" }
```

Every decision — allow or deny — is `200` with a `{ "valid": …, "reason": … }`
envelope; non-2xx means a config, auth or transport problem (`401` bad secret,
`503` `SCHEDULER_API_KEY` unset, `500` unexpected). Consumers are expected to
fail closed on those.

`tool` is currently only `"gate"`; anything else answers `tool_not_authorized`.
The full contract, including every denial reason, lives in
`docs/scheduler-integration.md` in the Gate Manager repo.

#### Required configuration

| Variable             | Purpose                                                         | If unset                   |
| -------------------- | --------------------------------------------------------------- | -------------------------- |
| `SCHEDULER_API_KEY`  | Shared bearer secret consumers present (≥32 chars)              | endpoint returns `503`     |
| `SLACK_BOT_TOKEN`    | Slack bot token (`xoxb-…`, scope `chat:write`) used to DM links | DMs become logged no-ops   |
| `GATE_BASE_URL`      | Public Gate Manager base URL, used to build `${base}/g/<token>` | link omitted from DMs      |
| `STRICT_SLACK_NAMES` | `"true"`/`"1"` rejects logins whose display name doesn't parse  | soft mode — warn but allow |

Generate the API key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```
