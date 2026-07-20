# Development Workflow Rules

## Before Coding

- Read the active backlog item and its acceptance criteria.
- Inspect the current code path before proposing a replacement.
- State assumptions and identify any blocking ambiguity.
- Prefer a small vertical slice that reaches a verified user outcome.
- Do not create unused abstractions for hypothetical future needs.

## During Coding

- Keep changes inside the approved task scope.
- Reuse established patterns when they are sound.
- Refactor only when necessary to complete the task safely.
- Remove obsolete code created by the same change.
- Never hide failures with empty catches, silent defaults, or fake success responses.
- Do not leave placeholders that appear complete. Use explicit `NOT_IMPLEMENTED` errors or a tracked backlog item.

## Verification

- Add tests that would fail before the change and pass after it.
- Run focused tests while developing.
- Run lint, typecheck, tests, and build before completion.
- For data changes, test migration and rollback/recovery considerations.
- For routes, test authentication, authorization, validation, success, not-found, conflict, and failure behavior as applicable.

## Completion Report

Report:

- backlog item completed
- files changed
- behavior added or fixed
- tests added
- exact commands run and results
- known limitations
- documentation updated
- next recommended backlog item

Do not say “everything works” unless the relevant behavior was actually exercised.
