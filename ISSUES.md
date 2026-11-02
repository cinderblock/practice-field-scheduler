# Issues

## Possible compromise while Next.js was unpatched

Production ran Next.js 15.3.3, in range for unauthenticated RCE CVE-2025-55182,
until 15.3.9 went live on 2026-11-02 at 9:44 AM PST (17:44Z). 15.3.9 is still in
range for image optimizer RCEs `GHSA-2xp9-vwfh-vxw4` and `GHSA-2464-fhr4-w9xw`,
fixed in 15.5.28, live since 2026-11-02 at 11:57 AM PST (19:57Z). The logs show what look like probes. The current
container looks clean, but earlier containers are gone and `/data` hasn't been
audited. Secrets in the container's environment: `AUTH_SECRET`, Slack client
secret, Slack bot token, FIRST API token, `SCHEDULER_API_KEY`. See the plan above. Audit and rotation each have their own thread.

## npm audit still reports critical production dependencies

`npm audit --omit=dev` on Next 15.5.28: critical in `next-auth` 5.0.0-beta.25
and `@auth/core` (fix: beta.32), and in `form-data` (through `axios`). High in
`@trpc/*`, `axios`, `zod`. Whether each applies here hasn't been checked. The app
signs in with Slack only.

## Nothing watches this repo's dependencies

Dependabot alerts are off (`gh api .../dependabot/alerts` answers 403 "disabled
for this repository"), and Renovate in ops only bumps the image pin, so a critical
Next.js advisory went unnoticed for about 11 months.

## Bookings across New Year look refused

`isValidDate` in `src/server/util/timeUtils.ts` requires the date to start with
the current year, and `reservation.add` validates with it. With a 7-day window,
late December should not be able to book January dates. Seen by reading the code,
not reproduced.
