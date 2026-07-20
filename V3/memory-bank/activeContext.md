# Active Context

Last updated: 2026-07-19

## Current Objective

Make the existing V3 foundation trustworthy before migrating more visible V2 features.

## Next Backlog Item

`FND-101 — Establish a reproducible clean-clone baseline`

## Immediate Sequence

1. FND-101 — clean-clone/install baseline and tracked generated files
2. FND-102 — real linting/formatting
3. FND-103 — meaningful test foundation
4. FND-104/105/106 — deterministic API/web/worker deployment
5. SEC/COL/BIN P0 data and authorization fixes

## Known Blockers

- Real price synchronization requires sanitized provider fixtures or verified endpoint access (`PRICE-701`).
- Several product decisions remain TBD in `CTRL-002`.

## Guardrails

- Do not edit historical V1/V2 code.
- Do not jump to UI polish while P0 integrity/deployment tasks remain open unless the user explicitly reprioritizes.
- Do not report placeholder routes/jobs as completed features.
