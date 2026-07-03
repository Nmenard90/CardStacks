# Coding Standards

## Main rule

Write code like a senior developer, but document it so a 10-year-old can understand what each file and function is for.

## Required for every source file

Every source file starts with a heading explaining:

- File name.
- Purpose.
- Why the file exists.

## Required for every meaningful function

Every meaningful function needs a heading explaining:

- What it does.
- Why it exists.
- Important validation/security/performance details.

## Architecture rules

- Main entry files stay thin.
- Routes receive HTTP requests.
- Schemas validate input.
- Services hold business logic.
- Repositories talk to the database.
- Providers talk to external APIs.
- Shared packages hold shared constants and types.

## Performance rules

- Paginate large results.
- Do not load all cards into memory just to filter them.
- Use database indexes for search.
- Use batch upserts for sync jobs.
- Avoid N+1 queries.
- Stream or batch imports.
- Cap upload size and page size.
- Return only fields needed by the UI.

## Error rules

- No silent fallbacks.
- Unexpected empty upstream API results are bugs.
- Validation errors return 400.
- Auth errors return 401.
- Permission errors return 403.
- Missing records return 404.
- Rate limit errors return 429.
- Unexpected errors return 500 with a safe message.
