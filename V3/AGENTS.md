# TCG V3 — Shared Agent Operating Instructions

## Mission

Build a production-minded Pokémon TCG collection platform that is fast for large collections, safe for public use, understandable to future developers, and reusable by future web, mobile, and desktop clients.

V3 is the active codebase. Preserve its TypeScript, Fastify, Prisma, PostgreSQL, React, and pnpm monorepo direction. Recover useful workflows from V2 without copying V2 architecture.

## One Shared Context

This file is the canonical instruction file for Claude Code and Codex. Do not maintain separate versions of project requirements for different agents.

Before planning or changing code, read:

1. `docs/ACTIVE_TASK.md`
2. `memory-bank/activeContext.md`
3. The selected item in `docs/BACKLOG.md`
4. Related sections of `docs/PRD.md`
5. Applicable files under `.claude/rules/`
6. Existing source and tests in the affected module

Use `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and `memory-bank/systemPatterns.md` for architectural decisions.

## Foreman Cooperation and Git Safety

- This session runs inside a task-specific Git worktree created by TCG Foreman.
- Multiple agents may work concurrently only in separate worktrees and non-overlapping task areas.
- Only one agent may modify this worktree.
- The Foreman owns commits, reviews, merges, branch changes, and provider failover.
- Do not run `git commit`, `merge`, `rebase`, `reset`, `clean`, `push`, `checkout`, `switch`, `stash`, or `worktree`.
- Do not attempt to modify the main checkout or another task's worktree.
- Before editing, inspect relevant source, tests, and the task prompt. The Foreman task prompt overrides stale coordination notes.
- Never discard or overwrite user work.
- A separate provider performs the review when available. Do not self-approve the task.
- Do not update shared coordination files such as `docs/ACTIVE_TASK.md`, `memory-bank/activeContext.md`, `memory-bank/progress.md`, or `HANDOFF.md` during ordinary parallel tasks unless the task explicitly requires it. These files cause merge conflicts across worktrees.
- Record task-specific implementation notes in `docs/agent-reports/<FOREMAN_TASK_ID>.md`.

## Cross-Agent Review

The Foreman automatically sends committed work to a different provider for read-only review when that provider is available. Review findings are advisory until verified against the code and tests, but requested changes must be addressed before merge. Agents must not launch independent reviewer sessions or communicate through ad-hoc files.

## Scope Control

- Implement one backlog item at a time unless tightly coupled tasks are explicitly approved together.
- Do not silently expand product scope.
- Do not rebuild working systems merely to prefer another style.
- Do not start a V4.
- Do not migrate code directly from `../web`, `../poketracker-v2`, or `../files`.
- When old behavior is useful, rewrite it to fit V3 contracts, security, tests, and data models.
- Mark missing product decisions as `TBD` and surface them before implementation when they block correctness.

## Architecture Boundaries

- `apps/api`: Fastify HTTP API and authentication boundary.
- `apps/web`: React browser client. It communicates through the API, not directly with PostgreSQL.
- `apps/worker`: catalog, price, and scheduled background jobs.
- `packages/db`: Prisma schema, migrations, seed logic, and shared Prisma client.
- `packages/shared`: framework-independent types, constants, and domain utilities.

Routes handle HTTP concerns. Services handle use cases. Repositories handle database access. Provider modules isolate external APIs. Entry points remain thin.

## Mandatory Development Cycle

For every implementation task:

1. Restate the selected backlog item and acceptance criteria.
2. Inspect current implementation, tests, and Git state.
3. Identify files to change and risks.
4. Obtain a read-only second opinion for high-risk architecture, security, migration, or data-integrity work.
5. Implement the smallest complete solution.
6. Add or update meaningful tests.
7. Run narrow checks first, then the full required checks.
8. Update task, documentation, memory, and handoff state.
9. Report exact commands and actual results.

## Required Verification

Before marking a code task done, run from `V3/`:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run database or integration checks when the task affects Prisma, repositories, migrations, authentication, imports, exports, or workers.

A command that was not run must be reported as not run. A package with no tests is not evidence that its behavior works.

## Documentation Requirements

When affected, update:

- `docs/agent-reports/<task-id>.md` — task-specific files, checks, results, and follow-up notes
- `README.md` — setup, commands, and public project state
- `HANDOFF.md` — current implementation context
- `BUGS.md` — unresolved defects and limitations
- `docs/BACKLOG.md` — task status and discoveries
- `memory-bank/activeContext.md` — immediate next work
- `memory-bank/progress.md` — factual completed/incomplete state
- `docs/API_FIELD_MAP.md` — external API field mappings
- `docs/decisions/` — durable architectural decisions

Do not rewrite unrelated documentation merely to change wording.

## User Standards

- No unused functions, imports, dependencies, or dead code.
- File and function headings where they add real clarity.
- Helpers grouped by purpose and thin entry points.
- No hard-coded deploy values or secrets.
- Explicit validation, errors, rate limiting, and abuse resistance.
- Efficient Big-O and memory-conscious handling of large collections.
- Comments explain why, not obvious syntax.
- Keep README, HANDOFF, BUGS, backlog, and memory current.

## Current Priority

Use `docs/BACKLOG.md` and `docs/ACTIVE_TASK.md` as the authority. The first objective is to make the foundation trustworthy: real linting, meaningful tests, reproducible builds, secure authentication/configuration, correct data integrity, and a deployable worker. Do not jump to polished feature work while P0 foundation tasks remain open unless the user explicitly redirects priority.
