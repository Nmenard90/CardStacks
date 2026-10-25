# PokéTracker Repository Instructions

## Active Codebase

The active product is `web/` (React frontend) backed by `poketracker-v2/` (Scala/ZIO backend, deployed on Railway — `web/`'s API calls go here). There is no other codebase in this repo: the old Node/HTML prototype (`files/`) and the abandoned rewrite effort (`V3/`) have both been deleted. All implementation belongs in `web/` and `poketracker-v2/`.

## Project Docs — Read First, Keep Current

- Start every session by reading `HANDOFF.md` (current state, in-flight work,
  migrations already run, domain gotchas) and `BUGS.md`.
- Before finishing, update `HANDOFF.md` → "Current state" and `BUGS.md` with
  anything that changed: shipped work, new bugs, migrations run, work left
  half-done and where it lives.

## Development Workflow

TCG Foreman is retired and has not been used for months (confirmed by the owner on 2026-10-25). Do not require or start Foreman.

- The user's instructions define the current task scope.
- Start implementation from current GitHub main in an isolated worktree; this checkout may be on older history.
- Preserve unrelated changes and stage only task-specific files.
- Multiple agents may work concurrently only in separate worktrees and non-overlapping task areas; only one agent may write in a worktree.
- Agents may create branches/worktrees and perform normal Git operations as needed for authorized work. Do not reset, clean, force-push, or rewrite history without explicit approval.
- Verify changes and show the concrete diff before deploying.

## Repository Safety

- Never expose, print, commit, or copy secret values from `.env` files.
- Do not run destructive database commands without explicit user approval.
- Do not delete directories or large chunks of the codebase without explicit user approval.
- Ignore generated directories such as `node_modules`, `dist`, `.turbo`, `target`, and `.git` during source analysis.
- Do not claim a task is complete unless its acceptance criteria and verification commands actually pass.
- Avoid editing shared coordination documents during normal parallel tasks. Put task-specific notes in `docs/agent-reports/<task-id>.md` instead.
- `poketracker-v2` migrations (`poketracker-v2/sql/schema.sql`) are applied manually via Railway's SQL editor, not automatically on deploy. Never push backend code that depends on a new migration (new column/table) before that migration has actually been run against production — Railway auto-deploys `poketracker-v2` on push to `main`, so code and schema can go live out of order and break every query touching the changed table. Confirm the migration has been run first, or hold the code push until it has.
