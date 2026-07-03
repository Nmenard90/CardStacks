# Security

## Secrets

- Never commit real `.env` files.
- Keep API keys in Railway environment variables.
- Use Supabase Auth for passwords/OAuth.
- Do not store user passwords in this database.

## API protections

- All private routes require auth.
- User identity comes from the verified Supabase token.
- Routes never accept `userId` from normal users for ownership decisions.
- Rate limiting is enabled globally.
- Admin routes require admin role or admin override.

## Import protections

- Cap upload size.
- Validate every row.
- Store row-level errors.
- Do not import unknown cards silently.
