# PokéTracker — AI Handoff Document

## What This App Is

A Pokemon TCG collection tracker. The user owns physical cards and wants to log which ones they have, in what condition, and what they're worth. The app also has binders (virtual binder pages), a trade analyzer, and a convention pricing mode.

---

## Repository Layout

```
tcg/
  web/                          ← React + TypeScript + Vite frontend — ALL frontend work goes here
  poketracker-v2/               ← Scala backend (ZIO + ZIO HTTP + Doobie + PostgreSQL)
  files/                        ← Legacy Node.js prototype — DO NOT TOUCH THIS FOLDER
```

---

## Frontend (`web/src/`)

### Pages (routes wired in `App.tsx`)

| Route | File | Purpose |
|---|---|---|
| `/` | `CollectionPage.tsx` | Browse cards by set; global search across all sets |
| `/bulk` | `BulkAddPage.tsx` | High-volume card entry; quick-add by number; Recently Added sidebar |
| `/owned` | `OwnedPage.tsx` | **All owned cards across every set** — needs to be routed in App.tsx |
| `/shelf` | `BinderShelfPage.tsx` | List of binders |
| `/binder/:id` | `BinderViewPage.tsx` | Single binder view |
| `/analyzer` | `AnalyzerPage.tsx` | Trade value analyzer |
| `/convention` | `ConventionModePage.tsx` | Convention price reporting |

**IMPORTANT:** `OwnedPage.tsx` exists and is complete but the `/owned` route was accidentally removed from `App.tsx` during recent edits. It must be re-added. See fix required section below.

### Components

| File | Purpose |
|---|---|
| `CardTile.tsx` | Single card in the grid — thumbnail, name, price, +/- stepper, condition badges |
| `SetSelector.tsx` | Header set picker — button opens searchable dropdown grouped by series |
| `RecentSidebar.tsx` | Sidebar on BulkAddPage showing cards added this session for binder placement |
| `CardPreview.tsx` | Large image overlay when hovering a card thumbnail |
| `ImportModal.tsx` | CSV import dialog on CollectionPage |
| `LoginScreen.tsx` | Shown when no user is logged in |
| `Toast.tsx` | Bottom-right notification system |
| `NavMenu.tsx` | Hamburger dropdown nav — **user does not want this, should be removed** |
| `BinderPickerModal.tsx` | Dead code — not used anywhere, can be deleted |

### API (`web/src/api/`)

```typescript
// cards.ts
getSets()                    → GET /api/sets
getCards(setId)              → GET /api/cards/:setId
searchCards(q)               → GET /api/search?q=...

// collection.ts
getCollection(userId)        → GET /api/collection/:userId
getStats(userId)             → GET /api/collection/:userId/stats
saveEntry(userId, cardId, conditions, selectedCond)  → POST /api/collection/:userId/:cardId
bulkSave(userId, items)      → POST /api/collection/:userId/bulk
getOwnedCards(userId)        → GET /api/collection/:userId/owned

// client.ts — axios instance
// baseURL = VITE_API_BASE env var, or '' (uses Vite proxy in dev)
// dev proxy: /api → https://hospitable-courtesy-production-60a0.up.railway.app
```

### Types (`web/src/types/index.ts`)

```typescript
Card           { id, setId, name, number, rarity?, artist?, images: {small,large}, prices?: CardPrices }
CardPrices     { nm?, lp?, mp?, hp?, dmg? }           // all optional, dollars
CardSet        { id, name, series, printedTotal, total, releaseDate, images: {symbol,logo}, ptcgoCode? }
ConditionCount { condition: string, quantity: number, price?: number }
CollectionEntry { id, userId, cardId, conditions: ConditionCount[], selectedCond, updatedAt }
CollectionStats { totalCards, uniqueCards, totalValue, setsEntered }
OwnedCard      { cardId, conditions: ConditionCount[], selectedCond, updatedAt, card: Card }
CondMap        = Record<string, number>   // frontend only — condition key → quantity
```

### Conditions (`web/src/lib/conditions.ts`)

```typescript
CONDS = ['NM', 'LP', 'MP', 'HP', 'DMG']   // canonical order
baseCond(key)          // strips ' 1st Ed' suffix: "NM 1st Ed" → "NM"
condPrice(card, key)   // price for one condition — uses per-condition API price, falls back to NM × multiplier
basePrice(card)        // NM market price
totalQty(condMap)      // sum of all quantities
cardValue(condMap, card) // total dollar value of all owned copies
fromCondList(list)     // ConditionCount[] → CondMap
toCondList(condMap, card) // CondMap → ConditionCount[] (attaches current prices)
```

---

## Backend (`poketracker-v2/src/main/scala/com/poketracker/`)

### Routes

```
GET  /api/sets                            → CardRoutes    — all sets (cached in DB, fetched from pokemontcg.io)
GET  /api/cards/:setId                    → CardRoutes    — cards in set with prices
GET  /api/search?q=...&n=...             → CardRoutes    — search by name or number
GET  /api/collection/:userId             → CollectionRoutes — all entries for user
GET  /api/collection/:userId/stats       → CollectionRoutes — total cards, value, sets entered
GET  /api/collection/:userId/owned       → CollectionRoutes — all owned cards with full card data (JOIN)
POST /api/collection/:userId/:cardId     → CollectionRoutes — save/update one card's conditions
POST /api/collection/:userId/bulk        → CollectionRoutes — save many cards at once
```

### Key Files

- `service/CardService.scala` — fetches sets/cards from pokemontcg.io API when not in DB; search fallback
- `service/CollectionService.scala` — collection business logic; `getOwnedCards` delegates to repo
- `repository/CollectionRepository.scala` — SQL queries; `findByUserWithCards` does a JOIN across collection_entries + cards + card_prices
- `repository/CardRepository.scala` — `searchCards` uses PostgreSQL full-text search + ILIKE; handles "N/M" number format via `split_part`
- `models/Collection.scala` — `CollectionEntry`, `ConditionCount`, `OwnedCard` case classes
- `service/PriceService.scala` — scrapes TCGTracking.com for per-condition prices

### Search in `CardService.scala` (BROKEN — needs fix)

When the local DB has no results, `searchCards` falls back to the pokemontcg.io API. Currently the fallback always uses `name:*query*` even when the query is a card number like "119" or "119/202". This returns nothing because no card name contains "119".

**Required fix:** Before calling the API, check if the query looks like a card number. If it does, use `number:N` instead of `name:*query*`.

```scala
// Current (wrong for numbers):
get(s"$base/cards?q=name:*$safe*&pageSize=$n")

// Should be:
val numericQ = "^(\\d+)(?:/\\d*)?$".r
val apiQuery = numericQ.findFirstMatchIn(q.trim) match
  case Some(m) => s"number:${m.group(1)}"
  case None    => s"name:*$safe*"
get(s"$base/cards?q=$apiQuery&pageSize=$n")
```

Note: The DB-level search in `CardRepository.searchCards` already handles "N/M" format correctly via `split_part` — only the API fallback needs fixing.

---

## Code Style Rules — MUST FOLLOW

These conventions are established throughout the codebase. All new code must follow them.

### 1. File header comment block (every file)

```typescript
/**
 * FILE: FileName.tsx
 * LOCATION: src/path/FileName.tsx
 *
 * PURPOSE:
 *   One paragraph describing what this file does and why it exists.
 *
 * IMPORTS EXPLAINED:
 *   ImportName   — why it's imported and what it provides
 *   AnotherImport — same
 *
 * USED BY: OtherFile.tsx (describe the relationship)
 * DEPENDS ON: backend endpoints or other dependencies
 */
```

### 2. Import comments

Every import group must have a comment explaining why each import is needed and what it does:

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query'  // server-state caching
import { useState, useEffect, useMemo, useRef } from 'react'
```

Or grouped with an explanation:

```typescript
// IMPORTS EXPLAINED:
//   useQuery    — React Query for caching sets/cards from the backend
//   Link        — client-side navigation without full page reload
```

### 3. Function/method comments

ALL functions get a PURPOSE comment block with parameters and returns:

```typescript
/**
 * PURPOSE: Debounced live search as the user types in the name/number box.
 *   Fires 250ms after the last keystroke to avoid hammering the backend.
 * @param card  The card to add
 */
```

### 4. React component structure order

Within a component function, always in this order:
1. Context hooks (`useUser`, `useToast`, `usePreview`)
2. State declarations (`useState`)
3. Server data (`useQuery`)
4. Effects (`useEffect`)
5. Event handlers / callbacks
6. Derived values (`useMemo`)
7. Early return (login guard)
8. JSX return

### 5. TypeScript

- Always type component props with a named `interface Props { ... }` or inline interface
- Use `type` for unions, `interface` for object shapes
- Prefer `type` imports: `import type { Card } from '../types'`
- No `any`. If something must be loosely typed use `unknown` and narrow it.

### 6. Inline styles

Use inline styles only for one-off values (widths, specific colors, spacing tweaks). Repeated patterns belong in CSS classes in the `.css` files or in a `const STYLE = '...'` string injected via `<style>`.

### 7. CSS class names

Use existing classes already defined in `web/src/styles/tracker.css`:
- `.page-tracker` — page wrapper
- `.tb-btn` — toolbar button (`.tb-btn.active` for active state, `.tb-btn.primary` for primary action)
- `.stats-bar` / `.stat` / `.stat-label` / `.stat-value` / `.gold` — stats row
- `.toolbar` / `.sort-label` — toolbar row
- `.card-grid` — card grid layout
- `.loading` / `.empty` — loading and empty state messages
- `.header-right` — right side of header
- `#app-wrap` / `#main` — page content area
- `.set-info` / `.set-name` / `.set-meta` / `.set-logo` — set banner

### 8. No unsolicited changes

Only change what was asked. If you notice something wrong nearby, mention it in your reply but do not change it unless asked.

### 9. Backend (Scala) style

Files follow the same comment convention adapted for Scala:

```scala
/**
 * FILE: FileName.scala
 * PACKAGE: com.poketracker.something
 * LOCATION: src/main/scala/com/poketracker/something/FileName.scala
 *
 * PURPOSE:
 *   ...
 *
 * IMPORTS EXPLAINED:
 *   cats.syntax.all.* — provides .void, .traverse_ etc.
 *   ...
 *
 * USED BY: ...
 * DEPENDS ON: ...
 */
```

---

## What Is Broken Right Now

### Bug 1: `/owned` route missing from `App.tsx`

`OwnedPage.tsx` exists and works. It was accidentally unrouted. Fix:

```typescript
// In web/src/App.tsx, add this import:
import { OwnedPage } from './pages/OwnedPage'

// And add this route inside <Routes>:
<Route path="/owned" element={<OwnedPage />} />
```

### Bug 2: Number/slash search returns no results

Described above in the CardService section. When users type a card number like "119" or "119/202" and the card isn't already in the DB, the pokemontcg.io API fallback uses a name search and finds nothing. Fix the `searchCards` fallback in `CardService.scala` to use `number:N` for numeric queries.

### Bug 3: NavMenu component should be removed

`web/src/components/NavMenu.tsx` was added but the user does not want a hamburger/dropdown nav. Navigation should be plain visible `<Link>` elements in `header-right`. Remove `NavMenu.tsx` and replace any usage of it with plain links.

In `CollectionPage.tsx` header, links should be:
```tsx
<div className="header-right">
  <Link to="/owned" className="tb-btn" style={{ textDecoration: 'none' }}>📦 My Collection</Link>
  <Link to="/bulk" className="tb-btn" style={{ textDecoration: 'none' }}>⚡ Bulk Add</Link>
  <Link to="/shelf" className="tb-btn" style={{ textDecoration: 'none' }}>📒 Binders</Link>
  <Link to="/analyzer" className="tb-btn" style={{ textDecoration: 'none' }}>⚖️ Analyzer</Link>
  <Link to="/convention" className="tb-btn" style={{ textDecoration: 'none' }}>🎪 Convention</Link>
  {/* page-specific action buttons here */}
  <button className="tb-btn" style={{ color: 'var(--muted)' }} onClick={() => setUser(null)}>Switch user</button>
</div>
```

### Bug 4: `CollectionPage.tsx` has been incorrectly restructured

The current `CollectionPage.tsx` has "mode tabs" (Browse Sets / My Collection) which the user did not ask for. The correct behavior is:

- **SetSelector always visible** — the user picks a set and sees all its cards
- **Search box always visible** — when 2+ chars are typed, searches all sets globally (replaces the set view with search results); clearing returns to set view
- **Header-right links** — plain visible links to other pages (not a hamburger, not tabs)
- **My Collection** lives at `/owned` as its own page (OwnedPage.tsx), linked from the header

The CollectionPage should be reverted to NOT have mode tabs. The version from commit `b07ef53` or `7616c63` is closer to correct — check git history.

---

## What the User Still Wants (Not Yet Built)

1. **Purchase price tracking** — ability to record what they paid for a card. Needs:
   - A `purchases` table in the DB (`user_id`, `card_id`, `condition`, `quantity`, `purchase_price`, `purchased_at`)
   - Scala: POST route to save a purchase, GET to retrieve purchases per card
   - Frontend: input on cards to log purchase price

2. **Price performance graph** — showing:
   - Market price over the past year (needs a `price_history` table with periodic snapshots)
   - A horizontal line at the user's purchase price (cost basis)
   - Library: install `recharts` in `web/` (`npm install recharts`)

---

## Deployment

- **Railway** auto-deploys on push to `main` branch of this repo
- Frontend: `npm run build` in `web/` (Vite → outputs `web/dist/`)
- Backend: sbt build, runs as JVM process
- Environment variables on Railway: `DATABASE_URL`, `POKEMONTCG_API_KEY`
- Dev proxy: `vite.config.ts` proxies `/api` → `https://hospitable-courtesy-production-60a0.up.railway.app`

---

## Things That Were Done Wrong — DO NOT REPEAT

1. **Do not edit `files/index.html` or `files/server.js`** — this is an old prototype, not the app
2. **Do not add binder features** (BinderPickerModal, `onAddToBinder` on CardTile) unless explicitly asked
3. **Do not use a hamburger/dropdown nav** — use visible `<Link>` elements in `header-right`
4. **Do not merge My Collection into CollectionPage as a tab** — it's a separate page at `/owned`
5. **Do not hide the SetSelector** during search mode or any other mode
6. **Do not remove working routes from App.tsx** without being asked
7. **Do not add features, refactor, or clean up code** beyond the exact task asked
8. **Do not add comments explaining what code does** — only add a comment when the WHY is non-obvious
