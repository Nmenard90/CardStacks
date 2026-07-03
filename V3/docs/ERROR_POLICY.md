# Error Policy

## Rule

Unexpected failures must be visible. Do not hide bugs with empty arrays, fake prices, or quiet defaults.

## Standard API error shape

```json
{
  "error": {
    "code": "CARD_NOT_FOUND",
    "message": "No Pokémon card was found for that id.",
    "details": {}
  }
}
```

## Error categories

- `VALIDATION_ERROR`: invalid user input.
- `AUTH_REQUIRED`: no valid login token.
- `FORBIDDEN`: user is not allowed to access the resource.
- `NOT_FOUND`: requested record does not exist.
- `RATE_LIMITED`: request limit exceeded.
- `UPSTREAM_API_ERROR`: external API failed.
- `UNEXPECTED_EMPTY_RESULT`: external API returned nothing when data was expected.
- `DATABASE_ERROR`: database operation failed.
- `INTERNAL_ERROR`: unexpected application error.
