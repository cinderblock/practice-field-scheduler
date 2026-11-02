# Issues

## Open tabs keep running the old client after a deploy

Nothing tells a tab that a new version is live, and tabs stay open for days.
`extraRobot` becoming required on `reservation.add` refused every booking from
such a tab (`plans/stale-tab-booking-failure.md`), and the person saw a raw
ZodError. That one is fixed, but any later change to a client/server contract can
do the same. Worth a version check that asks the tab to reload, and a readable
message for validation errors.

## Possible compromise while Next.js was unpatched

Production ran Next.js 15.3.3, in range for unauthenticated RCE CVE-2025-55182,
until the update to 15.3.9. The logs show what look like probes. The current
container looks clean, but earlier containers are gone and `/data` hasn't been
audited. Secrets in the container's environment: `AUTH_SECRET`, Slack client
secret, Slack bot token, FIRST API token, `SCHEDULER_API_KEY`. See the plan above.

## Nothing watches this repo's dependencies

Dependabot alerts are off (`gh api .../dependabot/alerts` answers 403 "disabled
for this repository"), and Renovate in ops only bumps the image pin, so a critical
Next.js advisory went unnoticed for about 11 months.

## Bookings across New Year look refused

`isValidDate` in `src/server/util/timeUtils.ts` requires the date to start with
the current year, and `reservation.add` validates with it. With a 7-day window,
late December should not be able to book January dates. Seen by reading the code,
not reproduced.
