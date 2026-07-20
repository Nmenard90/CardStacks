# Definition of Done

A backlog item is `DONE` only when all applicable conditions below are satisfied.

## Scope and Behavior

- Acceptance criteria are met.
- No unrelated scope was silently added.
- Placeholder behavior is not presented as complete.
- Failure, empty, loading, and boundary behavior are intentional.

## Code Quality

- Architecture boundaries are preserved.
- No unused code or dependencies remain.
- Inputs and external responses are validated.
- Errors are explicit and use the project error contract.
- Performance and memory behavior are appropriate for expected scale.
- Security/authorization is enforced server-side.

## Tests

- Tests were added or updated for the changed behavior.
- Relevant success and failure paths are covered.
- Tests would fail without the implementation/fix.
- No misleading `passWithNoTests` result is used as proof.

## Verification

From `V3/`, the following succeed unless the task explicitly does not affect executable code:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Additional migrations, integration tests, provider fixture tests, Docker builds, or browser checks are run when applicable.

## Documentation

- Backlog status/notes updated.
- Memory bank updated.
- README/HANDOFF/BUGS updated when affected.
- API field map or ADR updated when the task changes an external mapping or durable decision.

## Completion Report

The final report contains:

- exact files changed
- exact commands run and results
- known limitations or checks not run
- next recommended task
