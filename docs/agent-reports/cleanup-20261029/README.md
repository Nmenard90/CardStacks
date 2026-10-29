# Repo cleanup and Trade → Shop merge (2026-10-29)

Done before merging the 3D room, at the owner's request ("audit the GitHub and
clean up all the junk… two different trade pages that do the same thing… the
shop page still needs work"). Branch order: `main` → cleanup → shop merge →
3D room (`feat/3d-room`).

## Backup first

- `C:\Users\nicho\tcg-backups\2026-10-29-pre-cleanup\`: `all-refs.bundle`
  (every branch, remote branch and tag, verified), `refs.txt`, and for every
  worktree with local changes a `.diff` (against its commit) and a
  `.untracked.tgz` (untracked files, no `node_modules`/build output/env files).
- GitHub tag `backup/pre-cleanup-2026-10-29` on the old `main` (650949c).

## What was removed

| What | Why |
|---|---|
| OwnedPage, ShelfPage, duplicate `components/CollectionPage`, CollectionShelf, ExportModal, `lib/boxVariant`, `styles/shelf.css`, `public/icons.svg`, `extract-css.mjs` | Not reachable from any route or import |
| Shelf API (`/api/shelf`, ShelfRoutes/Service/Repository, `models/Shelf`) | Only the dead Shelf page used it (owner chose to remove). `shelf_items` table left in the database |
| `models/Trade`, `models/Reputation`, `TradeRepository`, reputation helpers | An older trade system that was never wired into the app |
| Share-link trading: TradePage, SharePage, CardBrowser, `lib/trading`, share / trade-list / make-offer endpoints | Folded into the shop (owner chose "merge into one") |
| ~500 CSS selectors | No component uses them (pruned per selector; runtime-built class names kept) |
| MySuite (munit template), `metals.sbt`, `.vscode/`, root collection CSV, old Spaces spec, the 2026-10-25 shop report | Template / IDE / junk / superseded |
| 27 worktrees, 31 local branches, 5 GitHub branches | Merged, superseded, or abandoned Foreman/V3 work |

## The merged shop

- **Public** `/shop/<slug>`: collection-style page, seller name + bio, set
  filter in the URL, search, rules banner (market prices, no % offers, trades
  welcome), buy request or trade request (catalog search, must cover the cards
  picked, optional cash), seller photos.
- **My Shop** `/shop/requests`: Requests · Offers (only when older offers
  exist) · Settings. Nav: "🛍 Shop" with a badge for new requests + unread offers.
- **Old links:** `/trade?offer=<id>` opens that offer in My Shop; `/s/<slug>`
  opens the same person's shop, or explains that the link moved.

## Verification

| Check | Result |
|---|---|
| `sbt test` with DB suites on a local Postgres (schema + migrations 010–020) | 66 passed, 1 skipped (live network) |
| `npx tsc -b`, `npm run build` | clean / ok |
| `npx eslint .` | only the 2 errors already on `main` (SpacesLivePage) |
| `npm run test:og` | 4/4 |
| `web/tests/shop-browser.mjs` (desktop 1440 + phone 390, mocked API) | 11/11 — `shop-browser-results.json`, screenshots in this folder |

## Before deploying

Migration 019 (`shop_photos`) must exist in production with the columns in
`poketracker-v2/sql/migration_019_shop_photos.sql`; the public shop reads it.
