# PokéTracker — Bug Tracker

Living list of known bugs and defects. Add new entries at the bottom of the
relevant section, or drop them in **Triage** if severity isn't known yet. Keep
IDs sequential and never reuse a number.

**Status:** `OPEN` · `IN PROGRESS` · `FIXED` · `WONTFIX` · `NEEDS REPRO`
**Severity:** `S1` blocker/crash · `S2` correctness · `S3` minor/UX · `S4` hygiene/docs · `ENH` enhancement

_Last updated: 2026-06-29 (session 2)._

---

## Summary

| ID | Sev | Status | Area | Summary |
|----|-----|--------|------|---------|
| 001 | S2 | FIXED | BulkAddPage | Ref + manual re-render counter → stale counts / lost work. Rewritten on a reducer. |
| 002 | S2 | WONTFIX | api/client | `VITE_API_BASE` must be set in Railway frontend env — live app works, confirming it is. |
| 003 | S3 | FIXED | BulkAddPage | `setState` in the search-debounce effect. Restructured into the timeout callback. |
| 004 | S3 | FIXED | BinderPickerModal, CollectionPage, ConventionModePage, OwnedPage | `setState` called synchronously inside effects (cascading renders). |
| 005 | S4 | FIXED | Main.scala (CORS) | Wildcard origin + `allowCredentials` is an invalid CORS pair (latent). |
| 006 | S4 | FIXED | ConventionModePage | React Compiler bailout ("memoization could not be preserved"), line 139. |
| 007 | S4 | FIXED | OwnedPage | `prefer-const` lint error (line 115). |
| 008 | S4 | FIXED | api/cards | Stale doc comment: search is "by name" but also matches numbers. |
| 009 | S2 | FIXED | Search (bulk) | `N/M` number search. Now a set-based lookup with an ambiguity picker. |
| 010 | S3 | FIXED | binder.css | Binder card images cropped left/right (`object-fit:cover`, unconstrained slot). |
| 011 | S2 | FIXED | Collection / catalog | Orphan prevention + repair deployed. (The export blank-rows symptom was actually BUG-014.) |
| 012 | S2 | FIXED | AnalyzerPage | "Quick Add from Your Collection" panel is a placeholder stub. |
| 013 | S3 | OPEN | Styling (all pages) | No central design system; per-page CSS, inconsistent colors + scaling. |
| 014 | ENH |OPEN | Import/Export | Export scope picker (set owned/full, collection, binder). Also fixes blank-row export. |
| 015 | S3 | FIXED | Import (UX/docs) | Import format is undocumented. |
| 016 | ENH | FIXED | Bulk search + quick-add | Two number boxes + set selector. Shipped with the BulkAddPage rewrite. |
| 017 | ENH | OPEN | Card detail + pricing | Click-through card view; optional purchase price; price-vs-cost + history. |
| 018 | ENH | OPEN | Pricing data | TCGplayer "last sold" price, per condition. |
| 019 | S2 | FIXED | Pricing / catalog | First-load always showed "no price"; infinite retry on partial matches. Fixed. |

---

## Fixed this session (2026-06-29, session 2)

### BUG-019 — Cards showing "no price"
**Status:** FIXED (backend; needs **Migration 001** run in Railway before deploying)

Two root causes found and fixed:

**Root cause 1 (primary):** `CardService.getCardsBySet`'s first-load branch (`case _ =>`)
fetched prices and stored them in the DB, then `yield result` returned the pokemontcg.io
cards which have `prices = None`. The DB re-read only happened in the "cached, some missing"
branch. Fix: added `withPrices <- repo.findCardsBySet(setId)` after the price fetch and
`yield withPrices` so first load returns prices immediately.

**Root cause 2 (performance/correctness):** If any card in a set has no price row (e.g. promos
not in TCGTracking), every subsequent `GET /api/cards/:setId` call triggered a fresh TCGTracking
round-trip. Fix: added `prices_fetched_at TIMESTAMPTZ` to `card_sets` (Migration 001) and two
new repo methods `isPricesFetchStale` / `markPricesFetched`. The "cached, some missing" branch
now skips the TCGTracking call if prices were attempted within the last 6 hours.

**Additional improvements:**
- `PriceService.findTcgSetId`: added URL-encoding for set names with `&` or spaces; replaced
  silent `catchAll` with explicit logging that shows the raw response body on parse failure and
  lists TCGTracking candidates when no match is found.
- `PriceService.fetchAndStorePrices`: logs product/price/match counts and a sample of unmatched
  card numbers so number-format mismatches are visible in Railway logs.
- New endpoint `GET /api/admin/refresh-prices/:setId`: re-fetches only prices from TCGTracking
  without re-downloading card metadata from pokemontcg.io. Cheaper than `/admin/refresh/:setId`
  when only prices are stale.

**Deploy order:** Run Migration 001 in Railway SQL Editor first, then push. The code degrades
gracefully if the column doesn't exist yet (`isPricesFetchStale` failure defaults to `true`).

---

## Fixed this session (2026-06-29)

### BUG-001 / BUG-003 / BUG-009 / BUG-016 — BulkAddPage rewrite
**Status:** FIXED (frontend; delivered, verify on Railway build)
`BulkAddPage.tsx` was rewritten from scratch and `RecentSidebar.tsx` deleted.
- **State** now lives in a `useReducer` (one immutable source of truth) instead
  of a mutable ref + manual `version` counter. The session count and Save button
  are always accurate (BUG-001).
- **Persistence:** the session is mirrored to `localStorage` per user and
  restored on load, so navigating away or refreshing no longer loses entered
  cards. A "N unsaved · saved locally" note shows in the header.
- **Set selector** added — picking a set makes "add by number" an instant,
  reliable local lookup (and pulls that set's prices).
- **Two number boxes** (`No.` / `Total`) plus a **Name** search (BUG-016).
- **Number search fixed** (BUG-009): no longer uses the broken backend text
  search. With a set selected → local match. Without a set → the total finds the
  set(s), which are loaded and matched locally. Leading zeros (`080` vs `80`) are
  handled. When a number/total matches **multiple** sets (numbers aren't globally
  unique), the candidates are shown in the dropdown to pick by set name instead
  of guessing. The Name box recognizes `number/total` queries too.
- **Debounced search** no longer calls `setState` synchronously in the effect
  body (BUG-003).
- **Sidebar removed** — the binder sidebar was only used here and was unwanted.
Typecheck + lint clean for this file.

### BUG-011 — Orphaned catalog cards (prevention + repair)
**Status:** FIXED (backend; deployed — `/api/admin/refresh-orphans` returned
`{"setsRefreshed": 0}`, confirming no DB orphans and that the build compiled).
- `CardService.ensureCached(cardIds)` runs on every save; any card with no
  catalog row has its set refreshed from the API (cards + prices). Both
  `CollectionRoutes` save paths call it, so import / bulk / quick-add can no
  longer create orphans.
- `CardRepository.findOrphanedCardIds` + `CardService.refreshOrphans` + endpoint
  `GET /api/admin/refresh-orphans` repair existing orphans in one call.
- **Note:** the originally-reported "missing data in the export" was *not* DB
  orphans — it was the export reading only the current set's cards on the
  frontend. That is fixed by BUG-014. BUG-011's value is preventing genuine
  future orphans (e.g. importing a CSV of an unloaded set).
- *Deferred:* flipping the `/owned` query to LEFT JOIN as a safety net (needs
  `Option` columns + frontend handling). Revisit only if needed.

### BUG-014 — Export scope picker
**Status:** FIXED (frontend; delivered via patch — confirm it's deployed).
Wired the existing-but-unconnected `ExportModal` into `CollectionPage`. Export
options: this set (owned only / full checklist), whole collection (owned), or a
binder. The collection-owned path pulls full card data from `/api/.../owned`,
which is what fixes the blank/$0 rows in exports.

---

## Open — by severity

### S2 — Correctness

**BUG-002 — Production API base URL may be empty** · `web/src/api/client.ts`
`BASE = import.meta.env.VITE_API_BASE ?? ''`; the Vite dev proxy is dev-only, so
a prod build needs `VITE_API_BASE` set. If the live app reaches the backend,
this is effectively fine — verify the Railway frontend env var, then close.

**BUG-012 — Analyzer "Quick Add from Your Collection" is a stub** ·
`web/src/pages/AnalyzerPage.tsx` (~272–282). The panel renders only hint text and
never fetches owned cards. Fix: fetch `getOwnedCards` and render clickable
quick-add tiles wired to the give/get lists.

~~**BUG-019 — Some cards show "no price"**~~ → FIXED (see below)

### S3 — Minor / UX

**BUG-004 — setState synchronously inside effects** · BinderPickerModal (~65),
CollectionPage (~144), ConventionModePage (~95), OwnedPage (~45). Cascading
renders; works today. Restructure each effect so state changes happen in async
callbacks / handlers, not the effect body. (The BulkAddPage instance is fixed.)

**BUG-010 — Binder card images cropped** · `web/src/styles/binder.css` (`.slv img`,
~102). `object-fit:cover` on an unconstrained slot crops the sides. Fix: use
`object-fit:contain`, or give the slot `aspect-ratio:2.5/3.5`.

**BUG-013 — No central design system** · all of `web/src/styles/*`. Per-page CSS
with hard-coded colors/sizes; nothing reads as one product. Fix: one token set
(colors, spacing, radius, type scale), refactor each page to consume it, unify
shared components. Larger effort — scope into stages.

**BUG-015 — Import format undocumented** · `ImportModal.tsx`, `lib/csv.ts`. Import
needs a `Card ID` + `Quantity` column (`Condition` optional, defaults NM) with
IDs like `sv6-66`; none of this is shown. Fix: show expected columns + an example
row, a "download template" CSV, and skipped-row reasons. Pairs with BUG-014.

### S4 — Hygiene / Docs

**BUG-005 — Invalid CORS combination** · `Main.scala` (~130). Wildcard origin +
`allowCredentials = Allow` is rejected by browsers together. Works now (no
cookies; userId is in the URL). Fix: drop `allowCredentials`, or echo the request
origin instead of `*`.

**BUG-006 — React Compiler memoization bailout** · `ConventionModePage.tsx` (~139).
Performance only. Rework the flagged `useMemo`/deps so the compiler preserves it.

**BUG-007 — `prefer-const`** · `OwnedPage.tsx` (115). `list` is `let` but never
reassigned. `eslint --fix` handles it.

**BUG-008 — Stale doc comment** · `api/cards.ts`. Header says search is "by name"
but the backend also matches numbers. Update the comment.

---

## ENH — Enhancements / future work

**BUG-017 — Card detail view + purchase price + price history.** Click a card →
detail view (modal or page); optionally record what was paid (never required);
show price change since purchase and price over time. Needs a `purchases` table
(user_id, card_id, condition, qty, price, purchased_at), `price_history`
snapshots, save/read routes, and a chart (recharts). Largest item — stage it
(detail view → purchase price → history chart).

**BUG-018 — TCGplayer "last sold" price, by condition.** Show TCGplayer last-sold
prices per condition alongside market price. Sourcing this specifically needs
investigation (data availability / terms). Pairs with BUG-017.

---

## Triage — reported, not yet investigated

- (none)
