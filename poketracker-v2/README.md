# CardStacks — backend (poketracker-v2)

Scala 3 + ZIO 2 + ZIO HTTP + Doobie over PostgreSQL. Deployed on Railway,
which builds and restarts it on every push to `main`. See the
[root README](../README.md) for the API and environment variables.

## Run it

```bash
sbt run        # needs DATABASE_* and SUPABASE_URL (see the root README)
sbt test
sbt assembly   # fat JAR, as the Dockerfile builds it
```

## Layout

- `api/` routes → `service/` rules → `repository/` SQL → `models/`.
- `service/CardService` — catalog: pokemontcg.io for English Pokémon,
  `TcgTrackingCatalog` for other games and the English sets pokemontcg.io
  lacks (`PokemonExtraSets`, set ids starting `tt`).
- `service/PriceService` + `CardmarketGuide` — per-condition, per-print
  prices; Cardmarket only when TCGplayer has no sales.
- `api/ShopRoutes` + `repository/ShopRepository` — the public shop, buyer
  requests, seller photos and shop settings. `TradingRoutes` only serves the
  older card offers (read, accept/decline, messages); new offers arrive as
  shop requests.
- `Main.scala` — wiring, plus background jobs: owned-set re-pricing (6h),
  catalog import for enabled games (daily), demo-account cleanup.

## Tests

`sbt test` runs the pure suites. The database suites (`TradingDbSuite`,
`ShopProfileDbSuite`, `CollectionRemovalSuite`, parts of `MultiGameSuite`)
run only when `TRADING_IT_DB_URL`, `SHOP_PROFILE_IT_DB_URL` and
`COLLECTION_IT_DB_URL` point at a throwaway local Postgres
(`jdbc:postgresql://127.0.0.1:<port>/postgres`) with `schema.sql` and every
migration applied — e.g. `initdb` a scratch folder, `pg_ctl -o "-p 55432" start`,
then `psql -p 55432 -f` each file in order.

## Database changes

`sql/schema.sql` and `sql/migration_*.sql` are run **by hand** in Railway's
SQL editor. Never push code that needs a new column or table before its
migration has been run in production — Railway deploys on push.
