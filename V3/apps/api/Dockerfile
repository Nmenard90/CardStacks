# File: apps/api/Dockerfile
# Purpose: Builds and runs the Fastify API service on Railway.
#
# Why this file exists:
#   The build must be reproducible across developer machines, CI, and
#   Railway: it installs exactly what pnpm-lock.yaml specifies, generates the
#   Prisma client from the committed schema, and ships a runtime image with
#   devDependencies pruned rather than a full development tree.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Recreate the pnpm workspace links after the complete source tree is copied.
# This guarantees that package-level executables such as Prisma point into the
# Linux pnpm store rather than a missing or overwritten package directory.
RUN pnpm install --offline --frozen-lockfile --force
# Prisma validates the datasource URL while generating, but does not connect.
# Scope a non-secret placeholder to this command so the build never depends on
# an ambient .env file and the value is not retained as runtime configuration.
RUN DATABASE_URL="postgresql://prisma:prisma@localhost:5432/build" \
    pnpm --filter @tcg/db exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter @tcg/shared build
RUN pnpm --filter @tcg/api build

FROM build AS prod
# `pnpm deploy` creates an isolated package with only the API's production
# dependency graph. This avoids carrying the monorepo, build tools, web app,
# or worker into the runtime image.
RUN pnpm --filter @tcg/api deploy --prod /prod/api

# `pnpm deploy` resolves the deployed node_modules straight from the pnpm
# content-addressable store, so it does not carry over the Prisma Client
# generated earlier in this stage (Prisma writes generated code directly to
# disk, which the store does not track). Without this, the deployed
# @prisma/client is a stub and the runtime image fails to start. Regenerate
# the client directly into the deployed package so it is self-contained, then
# drop the schema copy — it is only needed to steer generation output.
RUN mkdir -p /prod/api/prisma \
    && cp packages/db/prisma/schema.prisma /prod/api/prisma/schema.prisma \
    && DATABASE_URL="postgresql://prisma:prisma@localhost:5432/build" \
       pnpm --filter @tcg/db exec prisma generate --schema /prod/api/prisma/schema.prisma \
    && rm -rf /prod/api/prisma

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod --chown=node:node /prod/api ./
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
