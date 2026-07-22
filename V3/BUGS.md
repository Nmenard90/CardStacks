# BUGS

## Open

### BUG-001: Price provider needs real-source verification

- Status: Open
- Severity: High
- Area: Price Sync
- Found: 2026-07-03
- Notes: TCGplayer API key is not available. Price sync is designed around a configurable Open TCG / TCGTracking-style provider, but must be tested against the user's exact API source.
- Next step: Add a real response fixture from the user's pricing API and update `open-tcg-price.provider.ts` mapping.

### BUG-003: Google login requires Supabase dashboard setup

- Status: Open
- Severity: High
- Area: Auth
- Found: 2026-07-03
- Notes: Code supports Supabase Google OAuth, but Supabase provider settings and redirect URLs must be configured manually.
- Next step: Configure Supabase Auth providers and Railway/public URLs.

## Fixed

### BUG-008: Clean worktree verification required manual Prisma Client generation

- Status: Fixed
- Severity: High
- Area: Database / Build
- Found: 2026-07-22
- Fix: `@tcg/db` now generates Prisma Client during installation and before every package command that compiles or executes Prisma-dependent code. A regression check invalidates the generated declaration and confirms the normal database lint command restores it automatically.

### BUG-006: Web service unservable on Railway (missing start script, port, and host allowance)

- Status: Fixed
- Severity: High
- Area: Web / Deployment
- Found: 2026-07-19 (bad gateway; deploy log: "None of the selected packages has a start script")
- Notes: Three stacked causes. (1) Railway's deploy command calls `start`, which @tcg/web did not define — the service had only ever built and exited, hence its historical "Completed" status. (2) `vite preview` listens on 4173, not Railway's injected PORT. (3) Vite 6's preview host check rejects requests addressed to unlisted domains, which presents as a bad gateway with empty logs.
- Fix: added `start: vite preview`; new vite.config.ts sets preview host/PORT and `allowedHosts: true` (static frontend holds no secrets; the API enforces auth). Web build also compiles @tcg/shared first, same defense as BUG-005. Verified in-container: built with production-style env, served under PORT=8123, HTTP 200 both plain and with a Railway Host header.


### BUG-005: Worker undeployable on Railway (missing shared build + missing start script)

- Status: Fixed
- Severity: High
- Area: Worker / Deployment
- Found: 2026-07-19 (Railway build logs)
- Notes: Railway's build command compiles @tcg/worker directly with tsc, so @tcg/shared dist never existed (TS2307). Separately, Railway's deploy command calls a `start` script the worker did not have, so deploy would have failed even after a successful build.
- Fix: worker `build` now builds @tcg/shared first (verified by reproducing Railway's exact command from a clean state); added `start: node dist/index.js`. Cron requirement documented in HANDOFF.md.


### BUG-002: Import upload UI is not finished

- Status: Fixed
- Severity: Medium
- Area: Import/Export
- Found: 2026-07-03
- Notes: Backend services and route scaffolding exist, but the web file upload flow needs UX polish and real browser testing.
- Next step: Add drag/drop CSV/XLSX upload page and row-level import results.
- Fix (2026-07-12): Full import pipeline implemented — multipart upload route (10 MB cap, auth, rate-limited), SheetJS parsing (CSV + XLSX by magic bytes), zod row validation, condition alias normalization (NM/LP/MP/HP/DMG etc.), row-level ImportError records, per-row transactions so bad rows never roll back good ones, and ImportPanel in the web app. Merge rule enforced and tested: quantities combine ONLY within the same condition (owner decision 2026-07-12); the in-file merge key mirrors the CollectionItem unique constraint. 16 new unit tests (17 total) cover aliases, merge rule, variant resolution, and job status finalization.


### BUG-004: Fresh clone could not typecheck (missing build dependency + committed cache)

- Status: Fixed
- Severity: High
- Area: Build / Repo hygiene
- Found: 2026-07-12
- Notes: Two causes. (1) `turbo.json` had `typecheck` depend on `^typecheck`, but dependents resolve `@tcg/shared` types from its `dist/` output, so a clone with no `dist/` failed with TS2307/TS2305. (2) `V3/.turbo/cache` (57 files) was committed, so turbo replayed stale "successful" logs from the original machine instead of running checks, masking the failure.
- Fix: `typecheck` and `lint` now depend on `^build`; `.turbo` added to `.gitignore` and the committed cache removed from the index. Verified by deleting `packages/shared/dist` and re-running `turbo typecheck --force` (6/6 tasks pass, shared builds first).


## Suspected / Watchlist

- Test coverage is effectively zero: one test file exists (`apps/api/src/tests/error-handler.test.ts`). Each new feature must land with tests before this list can shrink.

- Variant naming may require adjustment after real Open TCG SKU data is tested.
- Large XLSX imports should be tested with 10k+ rows for memory usage.
- Search indexing should be verified after first production-sized catalog sync.

### BUG-007: DB package typecheck could not find Node `process`

- Status: Fixed
- Severity: Low
- Area: TypeScript / DB Package
- Found: 2026-07-03
- Fixed: 2026-07-03

#### Problem

`pnpm typecheck` failed in `packages/db/prisma/seed.ts`.

Error:

```txt
Cannot find name 'process'. Do you need to install type definitions for node?
