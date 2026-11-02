# Issues

## Possible compromise while Next.js was unpatched

Production ran Next.js 15.3.3, in range for unauthenticated RCE CVE-2025-55182,
until 15.3.9 went live on 2026-11-02 at 9:44 AM PST (17:44Z). The logs show what look like probes. The current
container looks clean, but earlier containers are gone and `/data` hasn't been
audited. Secrets in the container's environment: `AUTH_SECRET`, Slack client
secret, Slack bot token, FIRST API token, `SCHEDULER_API_KEY`. See the plan above. The user said not to rotate yet.

## Nothing watches this repo's dependencies

Dependabot alerts are off (`gh api .../dependabot/alerts` answers 403 "disabled
for this repository"), and Renovate in ops only bumps the image pin, so a critical
Next.js advisory went unnoticed for about 11 months.

## Bookings across New Year look refused

`isValidDate` in `src/server/util/timeUtils.ts` requires the date to start with
the current year, and `reservation.add` validates with it. With a 7-day window,
late December should not be able to book January dates. Seen by reading the code,
not reproduced.
