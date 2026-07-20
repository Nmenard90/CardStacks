# Coding Standards

- TypeScript must remain strict. Do not weaken compiler settings to make an error disappear.
- No unused functions, imports, variables, packages, feature flags, or unreachable branches.
- No `any` unless an external boundary makes it unavoidable and the value is immediately validated/narrowed.
- Prefer descriptive domain names over generic names such as `data`, `item`, or `result` when the meaning is not obvious.
- Functions should do one coherent job and expose clear input/output contracts.
- Entry points and route handlers remain thin.
- Group helpers by responsibility and keep them near their primary use unless shared reuse is proven.
- Avoid hard-coded URLs, secrets, ports, provider IDs, plan limits, or deployment-specific values.
- Validate all external inputs with Zod or an equivalent explicit schema.
- Use structured, actionable errors. Preserve root causes in logs without exposing sensitive internals to clients.
- Comments explain intent, constraints, and non-obvious decisions—not syntax.
- File/function headings are useful for important modules, external boundaries, and non-obvious workflows. Do not add repetitive comment noise to trivial code.
- Choose algorithms and data access patterns that remain safe for tens of thousands of cards and large collections.
- Avoid loading complete exports, imports, catalogs, or price histories into memory when streaming or batching is practical.
- Use constants/enums for stable domain values such as condition, variant, visibility, status, and access level.
- Do not duplicate domain normalization logic across API, worker, web, and shared packages.
