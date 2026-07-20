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
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @tcg/db exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter @tcg/shared build
RUN pnpm --filter @tcg/api build

FROM build AS prod
# `pnpm deploy` creates an isolated package with only the API's production
# dependency graph. This avoids carrying the monorepo, build tools, web app,
# or worker into the runtime image.
RUN pnpm --filter @tcg/api deploy --prod /prod/api

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod /prod/api ./
EXPOSE 4000
CMD ["node", "dist/server.js"]
