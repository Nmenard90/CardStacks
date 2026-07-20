# Technical Context

## Stack

- TypeScript 5.8
- Node.js 22 target/container
- pnpm 9.15 workspaces
- Turborepo 2.5
- Fastify 5
- Prisma 6 + PostgreSQL
- Zod 3
- Supabase JS/Auth
- React 19 + Vite 6
- Vitest 3
- Railway deployment

## Commands

```bash
pnpm install
pnpm dev
pnpm dev:worker
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm prepush
```

Current caveats:

- `lint` currently duplicates TypeScript checks rather than using a real linter.
- Several workspaces currently allow tests to pass with no tests.
- API/web Dockerfiles do not yet provide the intended deterministic production setup.
- Worker lacks a production Dockerfile/start script.
- Price sync is a deliberate placeholder.

Environment values are loaded from `.env` locally and Railway variables in deployment. Never store values in documentation or memory.
