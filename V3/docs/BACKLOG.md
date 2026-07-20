# PokéTracker V3 Product Backlog

Last updated: 2026-07-19

## Status Definitions

- `BACKLOG` — captured but not ready to start
- `READY` — requirements are clear enough to implement
- `IN_PROGRESS` — actively being implemented
- `BLOCKED` — cannot proceed without a dependency or decision
- `REVIEW` — implementation exists and requires verification
- `DONE` — acceptance criteria and required checks passed

## Priority Definitions

- `P0` — blocks safe development/deployment
- `P1` — required for a credible collection product
- `P2` — important expansion
- `P3` — later improvement

## Working Rule

Claude Code should implement one `READY` item at a time. It must not select a lower-priority feature while a relevant P0 task blocks its correctness unless the user explicitly changes priority.

---

## EPIC-000 — Project Control

### CTRL-001 — Install project-control documentation

- Priority: P0
- Status: DONE
- Dependencies: None

Acceptance criteria:

- Root and V3 `CLAUDE.md` exist.
- Modular rules exist under `V3/.claude/rules/`.
- SPEC, BRD, PRD, backlog, definition of done, workflow, legacy map, and memory bank exist.
- Historical code is explicitly read-only.

### CTRL-002 — Validate product decisions marked TBD

- Priority: P0
- Status: READY
- Dependencies: CTRL-001

Decisions to confirm and record:

- Whether binder slots must reference owned inventory.
- Which variants count toward a master set.
- Initial import/export column contract.
- Price provider endpoint and sample fixture.
- Whether Google OAuth is required for first release.
- Initial free/pro plan limits.

Acceptance criteria:

- Decisions are recorded in PRD or ADRs.
- No blocking TBD remains for the next selected implementation task.

---

## EPIC-100 — Trustworthy Development Foundation

### FND-101 — Establish a reproducible clean-clone baseline

- Priority: P0
- Status: READY
- Dependencies: CTRL-001

Work:

- Remove generated dependencies/build output from version control if tracked.
- Confirm root/V3 ignore rules.
- Document supported Node and pnpm versions.
- Run install from a clean clone/copy using the committed lockfile.

Acceptance criteria:

- `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- No real `.env`, `node_modules`, `dist`, `.turbo`, `.metals`, `.bloop`, or `target` content is tracked.
- Setup steps in README are accurate.

### FND-102 — Add real linting and formatting

- Priority: P0
- Status: READY
- Dependencies: FND-101

Work:

- Add ESLint configuration for TypeScript, React, and Node packages.
- Add deterministic formatting configuration.
- Replace package `lint` scripts that merely run TypeScript.
- Keep typecheck as a separate command.

Acceptance criteria:

- `pnpm lint` runs an actual linter across source and tests.
- `pnpm typecheck` remains separate.
- Unused imports/variables and unsafe patterns fail the quality gate.
- Formatting command/check is documented.

### FND-103 — Build a meaningful test foundation

- Priority: P0
- Status: READY
- Dependencies: FND-101

Work:

- Add shared Vitest conventions and test database strategy.
- Add Fastify injection tests.
- Add React test tooling.
- Remove `--passWithNoTests` after each package gains required tests.

Acceptance criteria:

- Every active workspace has at least one meaningful behavior test.
- API tests cover auth-required and validation behavior.
- Worker tests can run against sanitized provider fixtures.
- `pnpm test` cannot report a misleading green because no tests exist.

### FND-104 — Make API container builds deterministic

- Priority: P0
- Status: READY
- Dependencies: FND-101

Acceptance criteria:

- Docker build copies `pnpm-lock.yaml` before install.
- Install uses frozen lockfile.
- Prisma client is generated during build.
- Runtime image contains only required production artifacts/dependencies where practical.
- Container starts and `/health` succeeds.

### FND-105 — Make web production serving deterministic

- Priority: P0
- Status: READY
- Dependencies: FND-101

Acceptance criteria:

- Docker build uses the frozen lockfile.
- Static production assets are served by an intentional production server rather than relying on Vite preview as the final design.
- Railway port binding and health behavior are documented and tested.

### FND-106 — Add a deployable worker image and start command

- Priority: P0
- Status: READY
- Dependencies: FND-101

Acceptance criteria:

- Worker has build and production start commands.
- Worker Dockerfile uses the lockfile and generated Prisma client.
- Catalog and price jobs can be invoked explicitly.
- Railway schedule/start configuration is documented.
- Worker exits nonzero on failed jobs and records failure state.

### FND-107 — Verify complete Railway deployment

- Priority: P0
- Status: BLOCKED
- Dependencies: FND-104, FND-105, FND-106, SEC-104

Acceptance criteria:

- Postgres migration succeeds.
- API health endpoint succeeds publicly.
- Web loads and reaches API.
- Worker runs one safe test job.
- Service-specific environment variables are documented without values.

---

## EPIC-200 — Authentication, Authorization, and Abuse Protection

### SEC-201 — Separate sign-in and sign-up UX

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Wrong password never triggers sign-up.
- Sign-in, sign-up, Google OAuth, and recovery are separate intentional actions.
- Loading, disabled, success, and error states are accessible.
- Tests cover wrong password and existing-account behavior.

### SEC-202 — Add application auth/session state

- Priority: P0
- Status: READY
- Dependencies: SEC-201

Acceptance criteria:

- Session initialization has loading/authenticated/unauthenticated states.
- Users can sign out.
- Protected UI does not request private data while unauthenticated.
- Expired sessions return the user to a clear auth state.

### SEC-203 — Fail fast on production auth configuration

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Production API requires Supabase URL, anon key where needed, and service-role/verification configuration required by the chosen auth implementation.
- Development/test behavior is explicit.
- Startup errors identify missing variable names without exposing values.

### SEC-204 — Configure trusted proxy and route-specific rate limits

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Railway proxy behavior is documented and tested.
- General, auth, search, and import limits are actually applied.
- Client identification does not collapse all users into one proxy bucket.
- Rate-limit responses use the standard error contract.

### SEC-205 — Centralize effective access calculation

- Priority: P1
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- One service resolves role, active overrides, subscription, dates, and billing-disabled mode.
- API authorization uses this service for plan-gated behavior.
- Tests cover expiration and conflicting access states.

---

## EPIC-300 — Catalog and Search Correctness

### CAT-301 — Fix and centralize variant normalization

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- camelCase provider keys such as `reverseHolofoil` map to canonical shared variant keys.
- Normalization lives in a shared domain utility used by workers/imports as applicable.
- Unknown variants are recorded safely instead of silently collapsed.
- Unit tests cover known and edge-case provider keys.

### CAT-302 — Optimize catalog synchronization

- Priority: P1
- Status: READY
- Dependencies: CAT-301, FND-106

Acceptance criteria:

- Set/card/variant writes use bounded batching/transactions.
- Job records progress and per-record recoverable failures.
- Provider requests have timeout/retry behavior.
- Concurrent catalog runs are prevented.
- Full sync does not require holding the complete catalog in memory.

### CAT-303 — Define and implement indexed search strategy

- Priority: P1
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Empty searches are rejected unless set/card browsing is explicitly requested.
- Search supports name, set, and collector number ambiguity.
- PostgreSQL index/migration matches the chosen prefix/trigram/full-text strategy.
- Search tests include leading zeros and alphanumeric numbers.
- Performance is measured against a full catalog dataset.

### CAT-304 — Add bounded set/card listing

- Priority: P1
- Status: READY
- Dependencies: CAT-303

Acceptance criteria:

- Large card lists use pagination/cursors.
- Response contracts include pagination metadata.
- Web does not request/render an unbounded complete catalog.

---

## EPIC-400 — Collection Integrity and Core UX

### COL-401 — Fix deterministic collection bucket uniqueness

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Missing/default storage uses one canonical non-null representation or an equivalent deterministic unique key.
- Migration safely resolves existing duplicate/null buckets.
- Quick add, update, and import all use the same normalization.
- Tests prove duplicate buckets merge or conflict according to documented behavior.

### COL-402 — Validate card/variant relationships on writes

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Collection writes reject a variant from another card.
- Binder and trade writes reuse the same validation utility/service.
- Error is a clear validation/conflict response.
- Tests cover cross-card variant submission.

### COL-403 — Correct collection error mapping

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Not-found becomes 404 only for actual missing records.
- Unique conflicts become 409 where appropriate.
- Unexpected database failures remain internal errors and are logged safely.
- Tests cover each mapping.

### COL-404 — Add paginated/filterable owned collection API

- Priority: P1
- Status: READY
- Dependencies: COL-401, COL-402, CAT-303

Acceptance criteria:

- Filters include set, name/number, condition, variant, and storage location.
- Sorting and bounded page/cursor behavior are documented.
- Response includes card/set/variant summary DTOs and pagination metadata.

### COL-405 — Build authenticated application shell

- Priority: P1
- Status: READY
- Dependencies: SEC-202

Acceptance criteria:

- Navigation supports Search, Collection, Bulk Add, Binders, Master Sets, Imports/Exports, and later Trade tools.
- Route-level loading/error/empty states are consistent.
- Layout is usable on desktop and mobile widths.

### COL-406 — Rebuild V2 bulk-add workflow in V3

- Priority: P1
- Status: BLOCKED
- Dependencies: CAT-303, COL-401, COL-402, COL-405

Acceptance criteria:

- Meets all FR-BULK requirements in PRD.
- Handles set-scoped and ambiguous global collector-number lookup.
- Staged rows and per-row save outcomes are tested.

### COL-407 — Build complete owned-card view

- Priority: P1
- Status: BLOCKED
- Dependencies: COL-404, COL-405

Acceptance criteria:

- Paginated/filterable owned list.
- Inline quantity adjustment and safe removal.
- Condition/variant/storage visible.
- Value freshness/coverage visible when pricing exists.

### COL-408 — Implement purchase-lot workflows

- Priority: P2
- Status: READY
- Dependencies: COL-402

Acceptance criteria:

- Record lot quantity, total/each cost, date, seller/source, and notes.
- Cost basis calculations are documented and tested.
- Lot updates do not silently rewrite aggregate ownership.

---

## EPIC-500 — Import and Export

### IO-501 — Define versioned CSV/XLSX contract

- Priority: P0
- Status: READY
- Dependencies: CTRL-002

Acceptance criteria:

- Required/optional columns documented.
- Stable IDs and human-readable fallback fields defined.
- Conditions/variants/storage/date/price formats defined.
- Existing user CSV is mapped as a compatibility fixture.

### IO-502 — Implement secure upload and import parsing

- Priority: P1
- Status: BLOCKED
- Dependencies: IO-501, SEC-204, COL-401, COL-402

Acceptance criteria:

- Real multipart upload replaces placeholder filename.
- CSV/XLSX type, size, header, and row-count limits enforced.
- Processing is batched and job progress is saved.
- Ambiguous matches and row errors are reported.
- Partial success and retry behavior are tested.

### IO-503 — Implement streaming CSV export

- Priority: P1
- Status: READY
- Dependencies: COL-404

Acceptance criteria:

- Does not load full collection/file into one string.
- CSV escaping and formula neutralization are tested.
- Supports documented scopes.

### IO-504 — Implement real XLSX export

- Priority: P1
- Status: BLOCKED
- Dependencies: IO-501, COL-404

Acceptance criteria:

- Placeholder response removed.
- Workbook columns match contract.
- Large collections remain memory-conscious.
- Formula injection is neutralized.

### IO-505 — Verify import/export round trip

- Priority: P1
- Status: BLOCKED
- Dependencies: IO-502, IO-503, IO-504

Acceptance criteria:

- Exported supported fields re-import without loss.
- Existing user CSV imports with documented exceptions.
- Automated integration fixture verifies round trip.

---

## EPIC-600 — Binders and Sharing

### BIN-601 — Enforce binder slot integrity

- Priority: P0
- Status: READY
- Dependencies: COL-402, FND-103

Acceptance criteria:

- Slot number is within pocket size.
- Page and slot have reasonable upper bounds.
- Card/variant relationship is valid.
- Ownership requirement is enforced according to recorded product decision.
- Delete of an empty/nonexistent slot has intentional behavior.

### BIN-602 — Protect public binder DTO

- Priority: P0
- Status: READY
- Dependencies: FND-103

Acceptance criteria:

- Public endpoint uses explicit select/DTO.
- No user ID, raw JSON, source IDs/SKUs, private notes, or internal fields leak.
- Security test asserts the allowlist.

### BIN-603 — Complete binder management API

- Priority: P1
- Status: READY
- Dependencies: BIN-601

Acceptance criteria:

- Rename/update/delete binder.
- Change cover and visibility.
- Rotate/revoke share link.
- Move cards safely between slots.

### BIN-604 — Build V3 binder shelf and pages

- Priority: P1
- Status: BLOCKED
- Dependencies: COL-405, BIN-603

Acceptance criteria:

- Reproduces useful V2 shelf/page behavior.
- Card images are not cropped.
- Private/unlisted/public state is clear.
- Keyboard and mobile behavior are usable.

---

## EPIC-700 — Price Sync and Valuation

### PRICE-701 — Capture and sanitize real provider fixtures

- Priority: P0
- Status: BLOCKED
- Dependencies: User provides sample or live endpoint access

Acceptance criteria:

- Representative product/SKU/price responses are stored under test fixtures without secrets.
- `docs/API_FIELD_MAP.md` documents every used field and uncertainty.

### PRICE-702 — Implement verified SKU/card/variant mapping

- Priority: P0
- Status: BLOCKED
- Dependencies: PRICE-701, CAT-301

Acceptance criteria:

- Mapping is deterministic and tested against fixtures.
- Unmapped/ambiguous SKUs are recorded, not guessed.
- Existing card variants receive source IDs safely.

### PRICE-703 — Implement production price synchronization

- Priority: P1
- Status: BLOCKED
- Dependencies: PRICE-702, FND-106

Acceptance criteria:

- Placeholder partial-failure job removed.
- Current and snapshot prices write correctly.
- Retry, timeout, overlap protection, progress, and per-record errors exist.
- One verified live run succeeds.

### PRICE-704 — Add pricing/valuation API

- Priority: P1
- Status: BLOCKED
- Dependencies: PRICE-703, COL-404

Acceptance criteria:

- Card and collection value responses show source, currency, freshness, and coverage.
- Unknown/stale values remain explicit.
- Historical queries are bounded.

### PRICE-705 — Add price and collection-value UI

- Priority: P2
- Status: BLOCKED
- Dependencies: PRICE-704, COL-405

Acceptance criteria:

- Current price and freshness displayed.
- Historical chart does not imply missing points are zero.
- Collection total explains coverage.

---

## EPIC-800 — Master Sets

### MASTER-801 — Confirm master-set variant rules

- Priority: P1
- Status: BLOCKED
- Dependencies: CTRL-002

### MASTER-802 — Complete master-set API

- Priority: P1
- Status: BLOCKED
- Dependencies: MASTER-801, COL-404

Acceptance criteria:

- Completion and missing list derive from current collection.
- Variant rules are explicit and tested.
- Large sets remain bounded.

### MASTER-803 — Build master-set UI

- Priority: P2
- Status: BLOCKED
- Dependencies: MASTER-802, COL-405

---

## EPIC-900 — Trade and Convention Tools

### TRADE-901 — Complete trade-analysis API

- Priority: P2
- Status: BLOCKED
- Dependencies: PRICE-704, COL-402, SEC-205

### TRADE-902 — Build trade-analyzer UI

- Priority: P2
- Status: BLOCKED
- Dependencies: TRADE-901, COL-405

Acceptance criteria:

- Includes V2 quick-add-from-collection behavior.
- Give/receive totals and manual overrides are clear.

### VENDOR-903 — Build convention mode

- Priority: P2
- Status: BLOCKED
- Dependencies: PRICE-704, COL-405, SEC-205

---

## EPIC-1000 — Final Quality and Launch

### LAUNCH-1001 — End-to-end critical-path suite

- Priority: P1
- Status: BLOCKED
- Dependencies: SEC-202, COL-406, IO-505, BIN-604, PRICE-704

Critical paths:

- sign up/sign in/sign out
- search and quick add
- bulk add
- collection filter/update/remove
- import/export
- binder create/place/share/revoke

### LAUNCH-1002 — Accessibility and responsive review

- Priority: P1
- Status: BLOCKED
- Dependencies: Core web workflows complete

### LAUNCH-1003 — Production readiness review

- Priority: P0
- Status: BLOCKED
- Dependencies: FND-107, LAUNCH-1001, LAUNCH-1002

Acceptance criteria:

- Security checklist complete.
- Backups/migration recovery documented.
- Monitoring/logging reviewed.
- Known limitations visible.
- No P0 open defect.
