# Practice Field Reservation System

[![Test](https://github.com/camerontacklind/field-scheduler/actions/workflows/test.yml/badge.svg)](https://github.com/camerontacklind/field-scheduler/actions/workflows/test.yml)

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

Each method generates a new URL that you can use to access your development server.

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