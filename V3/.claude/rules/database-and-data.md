# Database and Data Rules

- PostgreSQL is the source of truth for catalog, users, collections, binders, imports, prices, and trades.
- Prisma schema changes require a named migration and an explanation of compatibility/data impact.
- Do not use `prisma db push` as a substitute for committed production migrations.
- Preserve referential integrity between cards and variants. Verify that a `variantId` belongs to the submitted `cardId` before writes.
- Collection inventory buckets must have deterministic uniqueness. Do not rely on nullable fields inside uniqueness rules when multiple `NULL` rows would violate product intent.
- Quantities must remain positive and bounded. Delete or merge behavior must be explicit.
- Card collector numbers are not globally unique and may contain leading zeros or letters.
- Search must not assume `080` and `80` are always different or always identical; numeric normalization applies only when both values are purely numeric.
- Large catalog and price syncs use bounded batches, checkpoints, and transaction sizes.
- Do not issue tens of thousands of sequential database round trips when a safe bulk strategy exists.
- Current prices and historical snapshots are separate concerns. Snapshot retention and deduplication must be intentional.
- External raw JSON is private/internal by default.
- Add indexes based on actual query patterns. A normal B-tree index does not automatically optimize arbitrary substring search.
- Import jobs preserve row-level errors and remain resumable or safely retryable where practical.
- Seed data must be deterministic and must never contain production secrets.
