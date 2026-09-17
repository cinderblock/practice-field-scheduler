# The deployed artifact. CI builds this on ubuntu-latest and pushes it to GHCR;
# ops (cinderblock/ops) pins a digest and decides what actually runs. This repo
# never deploys. See the README's Deployment section.
#
# Debian slim rather than Alpine: next/image optimisation needs sharp, whose
# prebuilt binaries are glibc.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The deployment's settings aren't known at build time and mustn't be baked in —
# that's why none of them are NEXT_PUBLIC_*. `next build` still imports
# src/env.js, so skip its validation here; the server validates at startup.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Unprivileged, with a fixed uid so the host can own the data directory it
# bind-mounts at DATA_DIR.
RUN useradd --system --create-home --uid 10001 app

COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

USER app
EXPOSE 3000
CMD ["node", "server.js"]
