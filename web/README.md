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
npx tsc -b      # typecheck — `npm run build` runs this, so type errors fail the deploy
npx eslint .    # lint — does not gate the build
npm run build
```

## Layout

- `src/pages/` — one file per route (see `src/App.tsx`): `/` Spaces,
  `/explore`, `/add`, `/binder/:id`, `/trade`, `/s/:slug` (public share
  page), `/analyzer`, `/convention`.
- `src/components/` — shared pieces. Cards are always drawn with
  `CardThumb` (holo, price ribbon, zoom) — via `CardTile` on catalog grids
  and `OwnedCardTile` on pickers and trade pages.
- `src/api/` — one file per backend area; `client.ts` adds the auth token
  and `?game=` to every request.
- `src/lib/` — shared logic: `conditions.ts` (condition keys, price math),
  `game.ts`, `cardSort.ts`, `trading.ts`, `csv.ts`.
- `src/styles/` — per-page CSS; `index.css` holds the shared tokens and the
  phone (≤720px) rules.

## Conventions

- View state the back button should undo goes in the URL
  (`useSearchParams`), not component state.
- Every layout must fit a 390px-wide screen with no sideways scroll.
- `localStorage` only for per-browser conveniences, always in `try/catch`.
