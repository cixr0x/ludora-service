# Minimal Search Results Endpoint Design

## Goal

Add a public catalog endpoint for search result cards that returns only the fields needed to render result links:

- `id`
- `canonical_name`
- `canonical_name_es`
- `image_url`
- `image_url_es`
- `item_type`
- `parent_item_id`
- `is_expansion`

The search page grid and shared header autocomplete will use this endpoint instead of `/api/items/summary`.

## Current State

`/api/items/summary` already avoids detail-only fields, but still returns taxonomy arrays, player counts, duration, complexity, rating, and listing flags. The search result cards only render the item id, preferred display name, alternate title, image, and expansion badge state. Regular search filtering is already applied server-side through the query string before rows are returned.

## Approach

Add `GET /api/items/search-results` in `ludora-service`. It will reuse the existing item search filter parser and where-clause builder so query semantics stay aligned with `/api/items` and `/api/items/summary`, but it will select only the minimal result-card columns and skip taxonomy lateral joins.

Keep `/api/items/summary` unchanged for compatibility. Update `ludora-ui` to add a matching minimal result type and loader, then replace both current summary consumers:

- `/search` grid and infinite scroll
- `SiteHeader` autocomplete suggestions

Semantic search stays unchanged for now because it returns rich item data and the page still applies local filtering to those semantic results.

## Data Flow

1. UI builds the same search query params it already sends today.
2. UI calls `/api/items/search-results`.
3. Service validates filters, applies approved-listing and optional search/filter predicates, orders by canonical name, and returns the minimal rows with pagination metadata.
4. UI maps minimal rows into the existing `Game` card shape.

## Error Handling

The new endpoint follows existing catalog route behavior: invalid query params return the same API errors as existing item search endpoints, and UI loaders continue to fall back to empty result lists on fetch failure.

## Testing

Service tests will assert the new endpoint response envelope, SQL selected fields, filter reuse, pagination params, and absence of summary-only joins/fields. UI tests will assert the API client uses `/api/items/search-results` and both search-result consumers use the minimal loader instead of summary loading.
