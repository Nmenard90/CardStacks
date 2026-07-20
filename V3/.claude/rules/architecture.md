# Architecture Rules

## API

- Fastify route modules handle request validation, authentication/authorization calls, HTTP status codes, and response shaping.
- Business decisions belong in service modules.
- Prisma queries belong in repositories except for very small administrative reads that have no reusable business logic.
- Use explicit response DTOs. Do not return broad Prisma records from public endpoints.
- Keep `app.ts` and `server.ts` thin.

## Web

- Separate page/layout concerns, feature state, API calls, and reusable UI.
- Do not put the complete application into `App.tsx`.
- Centralize server-state behavior and error handling rather than repeating fetch logic in every component.
- Authentication state must be represented explicitly.
- Accessible loading, empty, error, and disabled states are required.

## Worker

- External providers live behind provider modules.
- Provider responses are validated before database writes.
- Sync jobs are restartable, observable, bounded, and safe against overlapping runs.
- Process large datasets in bounded pages or batches.
- One malformed record should not necessarily destroy the entire job; record-level failures must be tracked when recovery is possible.

## Shared Packages

- `packages/shared` must not import React, Fastify, Prisma, or Node-only implementation details unless a dedicated package boundary is created.
- `packages/db` owns schema and Prisma lifecycle concerns.
- Avoid circular workspace dependencies.

## Decisions

Create an ADR under `docs/decisions/` when a decision changes data ownership, public API contracts, authentication, deployment architecture, pricing providers, search strategy, import format, or monetization behavior.
