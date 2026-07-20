# Legacy-to-V3 Feature Map

This file prevents useful V1/V2 behavior from being forgotten while also preventing direct architectural reuse.

| Legacy Area | Historical Location | V3 State | Migration Direction |
|---|---|---|---|
| Basic catalog/search | `web/src/components/CollectionPage.tsx`, Scala card routes | Partial | Keep V3 API; add correct indexed search, number ambiguity, pagination, and modern UI |
| Quick add | V2 collection/bulk workflows | Minimal V3 UI/API exists | Validate card/variant, deterministic bucket, improve UX |
| Bulk add | `web/src/pages/BulkAddPage.tsx` | Missing | Rebuild behavior after search and collection integrity tasks |
| Owned cards | `web/src/pages/OwnedPage.tsx` | Minimal collection panel | Build paginated/filterable V3 page |
| CSV import | `web/src/components/ImportModal.tsx`, V2 backend | Placeholder in V3 | Define versioned contract; implement real upload, batching, row errors |
| CSV export | `web/src/components/ExportModal.tsx` | Basic V3 CSV | Stream, add scopes and formula protection |
| XLSX | Not complete in V2 | Placeholder in V3 | Implement after shared import/export contract |
| Binder shelf/pages | `BinderShelfPage.tsx`, `BinderViewPage.tsx` | API partial, UI missing | Preserve shelf/page concept; enforce ownership/slot/privacy rules |
| Public binder | Limited historical behavior | V3 route partial | Explicit public DTO, revoke/rotate, public UI |
| Master set | Product intent/database support | API scaffold | Define variant rules, completion and missing list |
| Trade analyzer | `web/src/pages/AnalyzerPage.tsx` | Database only | Build after verified price service; include quick-add from collection |
| Convention mode | `web/src/pages/ConventionModePage.tsx` | Missing | Rebuild after price freshness and access control |
| Prices | V2 `PriceService`; historical bugs | V3 worker placeholder | Verify real provider fixtures; deterministic SKU/variant mapping |
| Purchase price/history | Roadmap only | Schema has purchase lots and snapshots | Add API/UI after collection and price foundation |
| Authentication | V2 custom/user context | Supabase partial | Keep Supabase; separate login/signup; session/logout/recovery |
| User IDs in routes | V2 API paths | Removed in V3 | Do not restore; derive user from verified token |
| Admin sync visibility | V2 maintenance endpoints | V3 partial | Keep V3 admin model; add pagination/audit/safe actions |
| Monetization | Not implemented | Schema scaffolding | Central effective-access service before UI/paywall work |

## Legacy Domain Rules Worth Preserving

- Collector number is unique only within a set.
- Pure numeric card numbers may differ only by leading zeros.
- Alphanumeric suffixes such as `7a` must not be normalized to `7`.
- Search must show set context for ambiguous number matches.
- Unknown prices must not appear as `$0`.
- Bulk entry must not lose staged work after a transient failure.
