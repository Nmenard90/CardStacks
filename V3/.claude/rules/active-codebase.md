# Active Codebase and Legacy Reference Rules

- The only active implementation is `V3/`.
- `../files/`, `../web/`, and `../poketracker-v2/` are read-only historical references.
- Never edit a historical directory as part of a V3 task.
- Never introduce Scala, sbt, ZIO, Doobie, Express, or the old browser-only architecture into V3.
- Never copy old authentication behavior that scopes requests by a user ID supplied in the URL. V3 must derive the user from verified authentication.
- Old UI code may be inspected for workflows, terminology, edge cases, and acceptance criteria.
- When behavior is migrated, write a new V3 implementation with current contracts, validation, authorization, tests, and documentation.
- Preserve the historical versions until the PRD and `docs/LEGACY_FEATURE_MAP.md` show that required behavior has been intentionally migrated or rejected.
