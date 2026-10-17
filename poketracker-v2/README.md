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
- `Main.scala` — wiring, plus background jobs: owned-set re-pricing (6h),
  catalog import for enabled games (daily), demo-account cleanup.

## Database changes

`sql/schema.sql` and `sql/migration_*.sql` are run **by hand** in Railway's
SQL editor. Never push code that needs a new column or table before its
migration has been run in production — Railway deploys on push.
