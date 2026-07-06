# Public API Rate Limiting Design

## Scope

Add rate limiting to the public-facing `ludora-service` API only. The admin service remains unchanged.

## Goals

- Reduce API abuse from direct scripted calls against the public API.
- Protect write and expensive endpoints more strictly than normal catalog reads.
- Preserve the existing JSON error response style.
- Keep the implementation configurable without database changes.

## Architecture

`ludora-service` will use `express-rate-limit` middleware mounted under `/api`. The health endpoint is skipped so uptime probes are not throttled. General API traffic receives a default per-IP limit, while selected write or expensive endpoints receive a stricter per-IP limit.

Rate limit settings are loaded from environment variables with local-safe defaults:

- `PUBLIC_API_RATE_LIMIT_WINDOW_MS`, default `60000`
- `PUBLIC_API_RATE_LIMIT_MAX`, default `120`
- `PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS`, default `60000`
- `PUBLIC_API_STRICT_RATE_LIMIT_MAX`, default `20`
- `TRUST_PROXY`, default disabled

## Endpoint Policy

General limiter:

- Applies to `/api/*`
- Skips `/api/health`

Strict limiter:

- `POST /api/contact`
- `POST /api/store-items/:id/clicks`
- `GET /api/items/semantic-search`

The strict limiter is layered before the route handlers and uses the same JSON `429` body:

```json
{ "error": { "message": "Too many requests" } }
```

## Error Handling

Rate-limited requests return HTTP `429` directly from the middleware with the existing public API error shape. Invalid JSON and downstream application errors continue to flow through the existing `jsonErrorHandler`.

## Testing

Add focused Vitest/Supertest coverage for:

- Config defaults and environment overrides.
- General API requests are throttled after the configured limit.
- `/api/health` is skipped by the limiter.
- Strict endpoints are throttled by the stricter configured limit.
- `429` responses use the expected JSON shape.

## Non-Goals

- No authentication or authorization.
- No Redis or distributed rate-limit store.
- No database DDL or DML.
- No changes to `ludora-admin`.
