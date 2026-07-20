# Security Rules

- Never print, return, commit, or copy secrets from `.env` files.
- Production must fail fast when required authentication configuration is absent.
- Verify Supabase tokens server-side and derive the application user from the verified subject.
- Never trust a client-supplied user ID for authorization.
- Every private resource query must enforce ownership or explicit admin access.
- Public endpoints return allowlisted DTO fields only; never return raw provider JSON or internal identifiers unless intentionally part of the public contract.
- Validate and bound all strings, numbers, pagination values, dates, file sizes, row counts, page numbers, slot numbers, and quantities.
- Apply route-specific rate limits to authentication, search, imports, and other expensive operations.
- Configure trusted proxy behavior deliberately for Railway before using client IPs for rate limiting or audit logs.
- Use parameterized database access through Prisma; do not interpolate untrusted SQL.
- Protect CSV/XLSX exports against spreadsheet formula injection.
- Import parsers must reject unsupported formats and malicious/oversized files before expensive processing.
- Logs must not include access tokens, passwords, service-role keys, complete connection strings, or unnecessary personal data.
- Authorization failures should not reveal whether another user's private resource exists.
- Billing/access decisions must be centralized; clients may hide UI but the API remains authoritative.
- Destructive admin or maintenance operations require explicit authorization, auditability, and safe failure behavior.
