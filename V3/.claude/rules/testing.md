# Testing and Quality Gate Rules

## Required Test Layers

- Unit tests for domain normalization, calculations, parsing, validation, and error mapping.
- Repository/integration tests for important Prisma behavior and ownership boundaries.
- API tests using Fastify injection for route contracts.
- Web component tests for core user interactions.
- Worker tests using provider fixtures and database write assertions.
- End-to-end tests for the critical collector loop when the foundation is ready.

## Critical Behaviors

Prioritize tests for:

- authentication and user provisioning
- cross-user access denial
- search name/set/number behavior
- collector-number leading-zero and alphanumeric cases
- quick add and collection bucket uniqueness
- quantity update/delete behavior
- binder ownership, variant/card consistency, slot bounds, and public DTO safety
- import row validation and partial failure reporting
- CSV/XLSX export escaping and spreadsheet formula protection
- catalog variant normalization
- price provider mappings and snapshot writes
- effective subscription/access decisions

## Quality Rules

- `--passWithNoTests` is temporary scaffolding, not an acceptable final state for implemented behavior.
- TypeScript compilation is not linting. Add and use a real linter.
- Tests must assert behavior, not merely that functions exist or constructors store arguments.
- Include success, invalid input, boundary, not-found, conflict, authorization, provider failure, and database failure paths when relevant.
- Do not mock the unit under test.
- External provider fixtures must be sanitized and committed without secrets.
- Flaky tests must be fixed or explicitly quarantined with a tracked backlog item; do not silently rerun until green.
