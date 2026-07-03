# Push Checklist

Run before every push:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm prepush
```

Update every push:

- `README.md`
- `HANDOFF.md`
- `BUGS.md`

Do not push if:

- `.env` is staged.
- Tests are failing.
- New route has no validation.
- New feature has no error handling.
- New external API code has no fixture or field-map update.
