# Ludora Service API Design

## Goal

Build the main public backend service for Ludora in `ludora-service`, using the same stack and shape as the admin backend while exposing read-only catalog APIs for the frontpage UI.

## Stack

- Node.js, TypeScript, Express 5
- `pg` for Postgres access through `LUDORA_DATABASE_URL`
- `dotenv` for local configuration
- `cors` with local UI origins allowed by default
- Vitest and Supertest for route tests with mocked database queries

## API Surface

All public routes are under `/api`.

- `GET /api/health` returns service status.
- `GET /api/front-page` returns ordered front page rows from `front_page_categories`, `front_page_category_items`, and `active_item`.
- `GET /api/items` returns active catalog items with taxonomy arrays and optional text search.
- `GET /api/items/:id` returns a single active item with taxonomy, contributors, publishers, tutorials, and store offers.
- `GET /api/items/:id/stores` returns public listed store offers for one item.
- `GET /api/items/:id/taxonomy` returns taxonomy and contributor metadata for one item.

## Data Sources

The service reads the same database tables and views used by the admin service:

- `active_item`
- `front_page_categories`
- `front_page_category_items`
- `boardgame_categories`
- `boardgame_mechanics`
- `boardgame_families`
- `item_categories`
- `item_mechanics`
- `item_families`
- `contributors`
- `item_contributors`
- `publishers`
- `item_publishers`
- `stores`
- `store_items`
- `tutorial_links`

The service does not perform writes, migrations, or SQL command execution outside normal read queries issued by API handlers.

## Frontend Integration

`ludora-ui` will use `VITE_LUDORA_API_URL` when provided and default to `http://localhost:4000`. The UI keeps its current static dataset as a fallback so the experience remains usable when the backend is not running.

## Error Handling

Responses use stable JSON envelopes:

- Success: `{ "data": ... }`
- Paginated lists: `{ "data": ..., "meta": { "limit": ..., "offset": ..., "count": ... } }`
- Errors: `{ "error": { "message": "..." } }`

Invalid item ids return `400`. Missing active items return `404`. Database errors are passed to the JSON error handler.

## Testing

Backend tests use mocked `Database` objects and assert response bodies plus SQL source tables. No tests connect to a real database. Frontend verification uses build output and browser smoke checks against the local dev server.
