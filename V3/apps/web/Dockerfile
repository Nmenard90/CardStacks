# File: apps/web/Dockerfile
# Purpose: Builds and previews the Vite web app on Railway.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @tcg/shared build
RUN pnpm --filter @tcg/web build

FROM base AS runner
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@tcg/web", "preview"]
