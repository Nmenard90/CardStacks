# API Field Map

Last verified: 2026-07-03

## PokémonTCG.io

Official docs: https://docs.pokemontcg.io
Base URL env var: `POKEMON_TCG_API_URL`
Auth env var: `POKEMON_TCG_API_KEY`

### Sets

Endpoint: `GET /sets`

External fields used:

| External field | Internal field |
| --- | --- |
| `id` | `sets.id` |
| `name` | `sets.name` |
| `series` | `sets.series` |
| `printedTotal` | `sets.printed_total` |
| `total` | `sets.total` |
| `ptcgoCode` | `sets.ptcgo_code` |
| `releaseDate` | `sets.release_date` |
| `updatedAt` | `sets.source_updated_at` |
| `images.symbol` | `sets.symbol_url` |
| `images.logo` | `sets.logo_url` |

### Cards

Endpoint: `GET /cards`

Query params used:

| Parameter | Purpose |
| --- | --- |
| `q` | Lucene-style search/filter query. |
| `page` | Paged catalog sync. |
| `pageSize` | Page size, max 250 according to docs. |
| `orderBy` | Stable sync/search ordering. |
| `select` | Smaller responses when possible. |

External fields used:

| External field | Internal field |
| --- | --- |
| `id` | `cards.id` |
| `name` | `cards.name` |
| `supertype` | `cards.supertype` |
| `subtypes` | `cards.subtypes` |
| `set.id` | `cards.set_id` |
| `number` | `cards.number` |
| `artist` | `cards.artist` |
| `rarity` | `cards.rarity` |
| `images.small` | `cards.image_small` |
| `images.large` | `cards.image_large` |
| full object | `cards.raw_json` |
| `tcgplayer.prices` keys | initial variant hints |

## Open TCG / TCGTracking-style provider

Official docs checked: https://tcgtracking.com/tcgapi/
Base URL env var: `OPEN_TCG_API_BASE_URL`
Category env var: `OPEN_TCG_POKEMON_CATEGORY_ID`

### SKU/variant pricing

Docs recommend `/skus` for condition/variant pricing.

Condition codes:

| External | Internal |
| --- | --- |
| `NM` | `NEAR_MINT` |
| `LP` | `LIGHTLY_PLAYED` |
| `MP` | `MODERATELY_PLAYED` |
| `HP` | `HEAVILY_PLAYED` |
| `DMG` | `DAMAGED` |

Variant fields documented:

| External | Purpose |
| --- | --- |
| `var` | Full variant display name. |
| `var_a` | Compact variant key. |
| `vid` | Stable variant id. |
| `lng` | Language code. |
| `cnd` | Condition code. |

Important implementation note:

The provider is intentionally isolated in `open-tcg-price.provider.ts` because the user's exact `tcg.io` source must be verified with real response samples before production price sync is trusted.
