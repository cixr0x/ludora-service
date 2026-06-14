# Ludora Service

Public read-only API for the Ludora catalog UI.

## Scripts

- `npm run dev` starts the local service on `PORT` or `4000`.
- `npm test` runs Vitest.
- `npm run build` compiles TypeScript.

## Environment

- `LUDORA_DATABASE_URL` is required when starting the real server.
- `CORS_ORIGIN` can override the default local UI origins.
- `PGSSLMODE=no-verify` enables hosted Postgres SSL without certificate verification.
- `OPENAI_API_KEY` enables semantic search.
- `OPENAI_EMBEDDING_MODEL` selects the query embedding model and defaults to `text-embedding-3-small`.
