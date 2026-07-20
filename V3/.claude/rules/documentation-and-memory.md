# Documentation and Memory Rules

## Source of Truth

- Product intent: `docs/PRD.md`
- Technical constraints: `docs/SPEC.md` and `docs/ARCHITECTURE.md`
- Ordered work: `docs/BACKLOG.md`
- Known defects: `BUGS.md`
- External mappings: `docs/API_FIELD_MAP.md`
- Live task state, assignment, provider, worktree, and review status: TCG Foreman

## Parallel-Worktree Discipline

Shared progress files create avoidable merge conflicts when several agents work concurrently. During a normal Foreman task:

- Create or update only `docs/agent-reports/<FOREMAN_TASK_ID>.md` for task-specific notes.
- Update `README.md`, `BUGS.md`, API documentation, or decision records only when the assigned implementation materially changes them.
- Do not edit `docs/ACTIVE_TASK.md`, `memory-bank/activeContext.md`, `memory-bank/progress.md`, or `HANDOFF.md` unless the task is specifically a coordination/documentation consolidation task.
- Do not rewrite unrelated documentation merely to change wording.

## Report Contents

The task report should record:

- Task ID and title
- Files changed
- Tests and commands actually run
- Acceptance criteria satisfied
- Known limitations or follow-up work

## Memory Discipline

- Keep reports concise and factual.
- Do not paste complete source files, secrets, or long logs.
- Do not record guesses as facts.
- Mark unresolved decisions as `TBD`.
