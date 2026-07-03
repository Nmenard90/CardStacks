# File: apps/api/Dockerfile
# Purpose: Builds and runs the Fastify API service on Railway.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @tcg/shared build
RUN pnpm --filter @tcg/api build

FROM base AS runner
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@tcg/api", "start"]
