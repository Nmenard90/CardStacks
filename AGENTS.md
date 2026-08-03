# PokéTracker Repository Instructions

## Active Codebase

The active product is `web/` (V2 React frontend) backed by `poketracker-v2/` (Scala/ZIO backend, deployed on Railway — `web/`'s API calls go here, it is NOT historical). `V3/` was a rewrite effort that has been abandoned — treat it as historical/dead, not a target for new work.

The following directories are historical reference only:

- `files/` — original Node/HTML prototype
- `V3/` — abandoned rewrite effort

Do not modify historical directories unless the user explicitly requests a historical fix. Historical code may be read only to recover product intent, workflows, interface behavior, and edge cases. All new production implementation belongs in `web/` and `poketracker-v2/`.

## Foreman-Controlled Development

This repository is developed through the local TCG Foreman.

- Every implementation task runs in its own Git worktree and branch.
- Multiple agents may work concurrently only in separate worktrees and non-overlapping task areas.
- Only one agent may write inside a particular worktree.
- The Foreman owns commits, reviews, merges, worktree creation, and provider failover.
- Agents must not commit, merge, rebase, reset, clean, push, switch branches, or create worktrees.
- Agents must not edit the main checkout.
- The task prompt supplied by Foreman is the authority for current scope.

## Repository Safety

- Never expose, print, commit, or copy secret values from `.env` files.
- Do not run destructive database commands without explicit user approval.
- Do not delete `V3/` or other historical directories without explicit user approval.
- Ignore generated directories such as `node_modules`, `dist`, `.turbo`, `target`, and `.git` during source analysis.
- Do not claim a task is complete unless its acceptance criteria and verification commands actually pass.
- Avoid editing shared coordination documents during normal parallel tasks. Put task-specific notes in `V3/docs/agent-reports/<task-id>.md` instead.
