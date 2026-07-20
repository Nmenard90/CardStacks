# System Patterns

## Monorepo Boundaries

- `apps/api` — Fastify HTTP/auth boundary
- `apps/web` — React client
- `apps/worker` — scheduled/external data jobs
- `packages/db` — Prisma schema/migrations/client
- `packages/shared` — framework-independent shared domain contracts

## API Pattern

Route -> validation/auth -> service -> repository -> Prisma/PostgreSQL.

Use explicit DTOs. Public endpoints never return broad database/provider objects.

## Worker Pattern

Job -> provider client -> validated provider DTO -> mapping/normalization -> bounded database writes -> sync run/error reporting.

## Error Pattern

External/client errors are validated and translated into the shared API error shape. Unexpected errors are logged with safe context and returned without internals.

## Data Pattern

- Card number is contextual to set.
- Variant belongs to one card and must be validated on every write.
- Collection bucket uniqueness must be deterministic.
- Current price and historical snapshots are separate tables.
- Imports and syncs track partial failures at row/entity level.

## Documentation Pattern

Backlog is the ordered work source. PRD is product behavior. Memory bank records only current context/progress. Durable decisions use ADRs.
