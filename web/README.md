# CardStacks — web

The React 19 + TypeScript + Vite frontend. See the [root README](../README.md)
for the whole app and [`HANDOFF.md`](../HANDOFF.md) for development notes.

## Run it

```bash
cp .env.example .env.local   # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

`/api` is proxied to the deployed backend; set `VITE_PROXY_TARGET` in
`.env.local` to point it at a local one. Production builds call the backend
directly through `VITE_API_BASE` (set in Railway).

## Check it

```bash
npx tsc -b         # typecheck — `npm run build` runs this, so type errors fail the deploy
npx eslint .       # lint — does not gate the build
npm run build
npm run test:room  # 3D room logic, card-art relay and room CSS scoping (node --test)
npm run test:og    # shop link previews
```

Browser tests (mocked API, real Chromium): `tests/room-browser.mjs` and
`tests/shop-browser.mjs` — how to run them is at the top of each file and in
the root README. `tests/room-live-smoke.mjs` checks the room against the real
backend with a throwaway demo account.

## Layout

- `src/pages/` — one file per route (see `src/App.tsx`): `/` the 3D room
  (`RoomPage`), `/spaces` (list view; old `/?area=…` links redirect there),
  `/explore`, `/add`, `/binder/:id`, `/shop/:slug` (public shop),
  `/shop/requests` (My Shop), `/analyzer`, `/convention`, `/privacy`, `/terms`.
  `/trade` and `/s/:slug` are kept only as redirects into the shop.
- `src/room3d/` — the 3D room (React Three Fiber). Plain JS with `.d.ts`
  shims; `data/useLiveRoom.ts` turns the API into the room's state. Its CSS is
  scoped under `.room3d` at build time (`room3dCss.mjs` + `vite.config.ts`),
  and its art loads through the `/card-art` relay (`cardArt.mjs`) because
  TCGplayer's image CDN sends no CORS headers.
- `src/components/` — shared pieces. Cards are always drawn with
  `CardThumb` (holo, price ribbon, zoom) — via `CardTile` on catalog grids,
  `OwnedCardTile` on pickers and `ShopCardTile` on the shop.
- `src/api/` — one file per backend area; `client.ts` adds the auth token
  and `?game=` to every request.
- `src/lib/` — shared logic: `conditions.ts` (condition keys, price math),
  `game.ts`, `cardSort.ts`, `csv.ts`.
- `src/styles/` — per-page CSS; `index.css` holds the shared tokens and the
  phone (≤720px) rules.
- `server.mjs` — the production server: static files, Open Graph tags for
  shop links (`ogTags.mjs`) and the `/card-art` relay.

## Conventions

- View state the back button should undo goes in the URL
  (`useSearchParams`), not component state.
- Every layout must fit a 390px-wide screen with no sideways scroll.
- `localStorage` only for per-browser conveniences, always in `try/catch`.
