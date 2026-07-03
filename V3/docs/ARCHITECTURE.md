# Architecture

## Goal

Keep the backend as the source of truth so web, mobile, and desktop apps all use the same API.

## Packages

- `apps/api`: HTTP API.
- `apps/web`: React web client.
- `apps/worker`: scheduled sync jobs.
- `packages/db`: database schema and seed.
- `packages/shared`: shared constants/types.

## Module pattern

Each backend module should use this structure:

```txt
module/
  module.routes.ts       # HTTP routes
  module.schemas.ts      # request validation
  module.service.ts      # business logic
  module.repository.ts   # database queries
  module.types.ts        # local types
  module.test.ts         # tests
```

## Data flow

Web/mobile/desktop → API → service → repository → PostgreSQL.

External APIs are called only from providers/workers, not from the frontend.
