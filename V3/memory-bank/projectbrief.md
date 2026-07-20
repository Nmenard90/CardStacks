# Project Brief

PokéTracker V3 is the active TypeScript rebuild of a Pokémon TCG collection tracker. It must support fast catalog search, accurate collection inventory by card/variant/condition/quantity/location, binders, master-set progress, current and historical prices, CSV/XLSX import/export, trade analysis, and future premium/vendor capabilities.

The active code is inside `V3/`. The older Node prototype and V2 React/Scala implementation are read-only references for product behavior.

Primary constraints:

- PostgreSQL is the source of truth.
- Fastify API is the security boundary for all clients.
- Supabase provides authentication.
- Railway is the initial deployment platform.
- PokémonTCG.io supplies catalog data.
- TCGplayer API access is unavailable.
- Price-provider mapping must be verified with real sanitized fixtures.
- Do not start another rewrite.
