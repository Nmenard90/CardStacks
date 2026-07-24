# Definition of Done

A backlog item is `DONE` only when all applicable conditions below are satisfied.

## Task Size (binding on the planner)

- One task = one feature. Target under 10 changed files.
- If a description joins separate capabilities with "and", SPLIT IT.
  "Set browsing, search, card detail, and images" is four tasks, not one.
- Every task must list `contextPaths` naming only the files an agent needs to
  read. Never list whole app directories.
- `locks` must name only the areas the task actually edits. A frontend task
  does not lock `apps/api`, `apps/worker`, or `packages/db`.
- A task an agent cannot finish in a single session is too large. Prefer a
  sequence of small merged tasks over one large one.
- Tasks emitted in the same planning pass MUST have disjoint file scopes. Two
  agents must never be able to edit the same file. If the next work cannot be
  split disjointly, emit ONE task.
- Never emit a task whose prerequisite has not merged.

## Environment Boundaries (binding on the planner and on every agent)

Agents run in a sandbox. These are hard limits, not preferences. A task whose
acceptance depends on anything in the "cannot" list can never pass and must
never be created.

Agents CAN:

- read and edit files inside their assigned worktree
- run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- run `node`, `tsc`, `vitest`, `vite build` directly
- add a devDependency when a required test capability is genuinely missing,
  and say so in the report

Agents CANNOT:

- launch a browser, drive a browser, or take screenshots
- start a long-lived local server and interact with it
- reach the network, install via Corepack, or fetch from a registry at runtime
- deploy, inspect Railway, or verify anything about a running production service
- run Docker

Therefore:

- **Every acceptance criterion must be checkable by a command in the list above.**
- Browser verification, responsive/visual inspection, deep-link checks, and
  Railway/production acceptance are performed by the human AFTER merge. They must
  NEVER appear in a task's acceptance criteria.
- If a requirement genuinely needs a browser or a deployment, split it: the agent
  task covers what is machine-checkable, and the human check is recorded in the
  backlog as a separate post-merge step.
- An agent that hits one of these limits reports it once and moves on. It does not
  retry, and it does not invent a workaround.

## Protected Code

- `web/` and `poketracker-v2/` are the LIVE V2 production app. Never modify them.
  They may be read as a reference only.
- Foreman's own tooling lives in a separate repository. Never create tooling tasks
  inside this repository.

## Scope and Behavior

- Acceptance criteria are met.
- No unrelated scope was silently added.
- Placeholder behavior is not presented as complete.
- Existing working features are never replaced with "not available yet" panels.
- Failure, empty, loading, and boundary behavior are intentional and reachable
  from real application routing, not only from test-only preview exports.

## Code Quality

- Architecture boundaries are preserved.
- No unused code or dependencies remain.
- Inputs and external responses are validated.
- Errors are explicit and use the project error contract.
- Performance and memory behavior are appropriate for expected scale.
- Security/authorization is enforced server-side, never from client-held claims.

## Tests

- Tests were added or updated for the changed behavior.
- Relevant success and failure paths are covered.
- Tests would fail without the implementation/fix.
- Tests exercise the real component, not a preview or stand-in.
- No misleading `passWithNoTests` result is used as proof.
- Tests are never weakened, skipped, deleted, or threshold-lowered to make
  verification pass. Fix the root cause instead.

## Verification

From `V3/`, the following succeed unless the task explicitly does not affect
executable code:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

This is the complete automated acceptance bar. Nothing outside it gates a merge.

## Documentation

- Backlog status/notes updated.
- Memory bank updated.
- README/HANDOFF/BUGS updated when affected.
- API field map or ADR updated when the task changes an external mapping or
  durable decision.

## Completion Report

The final report contains:

- exact files changed
- exact commands run and results
- known limitations or checks not run
- next recommended task
