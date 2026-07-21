# File: apps/worker/Dockerfile
# Purpose:
#   Builds the worker image and runs exactly one catalog/price sync job per
#   container invocation, then exits.
#
# Why this shape:
#   Railway triggers this image on a schedule per job type (see
#   railway.catalog-sync.toml / railway.price-sync.toml) rather than running
#   it as a long-lived service, so the image must build deterministically,
#   generate the Prisma client, and exit nonzero on failure.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @tcg/db db:generate
RUN pnpm --filter @tcg/shared build
RUN pnpm --filter @tcg/worker build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
# No job runs without an explicit command. Each Railway worker service
# overrides this with its own start command (pnpm --filter @tcg/worker
# start:sync-catalog / start:sync-prices); running the image unmodified
# fails fast with a nonzero exit instead of doing nothing.
CMD ["pnpm", "--filter", "@tcg/worker", "start"]
