# Progress

Last updated: 2026-07-19

## Verified Present in V3

- pnpm/Turborepo monorepo structure
- Fastify API, React web app, TypeScript worker
- Prisma schema for users, plans, access overrides, catalog, variants, collection, purchase lots, prices, sync runs/errors, binders, imports, and trade analysis
- Supabase authentication plugin/scaffolding
- API modules for health, users, catalog, collection, binders, master sets, prices, imports, exports, and admin
- Basic web login/search/collection panels
- Catalog worker and provider modules
- Existing architecture, coding, security, error, field-map, and push-checklist documentation

## Partial or Placeholder

- Web application is only a minimal shell compared with V2.
- Price sync records a deliberate partial failure and writes no provider prices.
- Import upload is not wired to a real file.
- XLSX export is a placeholder.
- Binder API lacks complete management/integrity/public DTO behavior.
- Master set, billing/access, trade, and several admin capabilities are incomplete.
- Tests are minimal and most packages permit no-test success.
- Lint scripts are TypeScript compilation rather than real linting.
- Deployment is not fully verified; worker production path is incomplete.

## Not Yet Verified

- Fresh-clone install/build
- Railway API/web/worker production health
- Complete migration state
- Live catalog sync at full scale
- Real price-provider mapping
- Existing collection CSV import compatibility
- Cross-user authorization coverage

## Current Recommendation

Begin with `FND-101` and proceed through the P0 foundation/data-integrity tasks in `docs/BACKLOG.md`. Preserve V2 solely as a behavior reference.
