# Minimal Search Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal public search-results endpoint and replace both UI summary consumers with it.

**Architecture:** Reuse the existing catalog search filter parser and predicate builder, but add a new select/query builder that returns only result-card fields. Keep `/api/items/summary` unchanged. Add a UI API/data loader for minimal result rows and use it in the search grid plus header autocomplete.

**Tech Stack:** Express, TypeScript, Vitest, React, Vite, Node test runner source tests.

---

## File Structure

- Modify `C:/PROJECTS/ludora/ludora-service/src/app.test.ts`: service API regression tests.
- Modify `C:/PROJECTS/ludora/ludora-service/src/routes/catalog.ts`: new route, select list, and query builder.
- Modify `C:/PROJECTS/ludora/ludora-ui/src/app/api/catalog.ts`: minimal API type and fetcher.
- Modify `C:/PROJECTS/ludora/ludora-ui/src/app/data/catalog.ts`: minimal loader and mapper.
- Modify `C:/PROJECTS/ludora/ludora-ui/src/app/pages/Search.tsx`: use minimal loader for regular search results.
- Modify `C:/PROJECTS/ludora/ludora-ui/src/app/components/SiteHeader.tsx`: use minimal loader for autocomplete.
- Modify `C:/PROJECTS/ludora/ludora-ui/src/app/utils/lightweightCatalogSource.test.mjs`: source-level assertions for the endpoint and consumers.

## Task 1: Service Endpoint

**Files:**
- Modify: `C:/PROJECTS/ludora/ludora-service/src/app.test.ts`
- Modify: `C:/PROJECTS/ludora/ludora-service/src/routes/catalog.ts`

- [ ] **Step 1: Write the failing service test**

Add this test after the existing `/api/items/summary` test in `src/app.test.ts`:

```ts
  it('lists minimal search result items without summary-only fields', async () => {
    const rows = [
      {
        canonical_name: 'Coffee Rush',
        canonical_name_es: 'Cafeteria',
        id: 77,
        image_url: 'https://cdn.example/coffee.jpg',
        image_url_es: 'https://cdn.example/cafe.jpg',
        is_expansion: false,
        item_type: 'base_game',
        parent_item_id: null
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get(
      '/api/items/search-results?q=coffee&players=4&duration_min=30&duration_max=75&complexity_min=2&complexity_max=4&category_ids=5,7&mechanic_ids=8,9&limit=24&offset=6'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      meta: {
        count: 1,
        limit: 24,
        offset: 6
      }
    });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('from active_item i');
    expect(sql).toContain('i.canonical_name');
    expect(sql).toContain('i.canonical_name_es');
    expect(sql).toContain('i.image_url');
    expect(sql).toContain('i.image_url_es');
    expect(sql).toContain('i.item_type');
    expect(sql).toContain('i.parent_item_id');
    expect(sql).toContain('i.is_expansion');
    expect(sql).toContain('i.has_approved_listing = true');
    expect(sql).toContain("concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es) ilike $1 escape '\\'");
    expect(sql).toContain('order by i.canonical_name asc, i.id asc');
    expect(sql).not.toContain('coalesce(categories.categories');
    expect(sql).not.toContain('coalesce(mechanics.mechanics');
    expect(sql).not.toContain('left join lateral');
    expect(sql).not.toContain('i.min_players,');
    expect(sql).not.toContain('i.max_players,');
    expect(sql).not.toContain('i.min_minutes,');
    expect(sql).not.toContain('i.max_minutes,');
    expect(sql).not.toContain('i.complexity,');
    expect(sql).not.toContain('i.rating,');
    expect(queries[0]?.params).toEqual(['%coffee%', 4, 30, 75, 2, 4, [5, 7], [8, 9], 24, 6]);
  });
```

- [ ] **Step 2: Verify the service test fails**

Run:

```powershell
npm test -- src/app.test.ts
```

Expected: FAIL because `GET /api/items/search-results` is not registered and returns `404`.

- [ ] **Step 3: Implement the minimal service endpoint**

In `src/routes/catalog.ts`, add a route after `/items/summary` and before `/items/filter-options`:

```ts
  router.get('/items/search-results', async (request, response, next) => {
    try {
      const filters = itemSearchFiltersFromQuery(request.query);
      const query = buildItemSearchResultsQuery(filters);
      const result = await database.query(query.sql, query.params);

      response.json({
        data: result.rows,
        meta: {
          count: result.rows.length,
          limit: filters.limit,
          offset: filters.offset
        }
      });
    } catch (error) {
      next(error);
    }
  });
```

Add this select near `itemSummarySelect`:

```ts
const itemSearchResultSelect = `
  i.id,
  i.canonical_name,
  i.canonical_name_es,
  i.image_url,
  i.image_url_es,
  i.item_type,
  i.parent_item_id,
  i.is_expansion
`;
```

Add this query builder after `buildItemSummaryQuery`:

```ts
function buildItemSearchResultsQuery(filters: ItemSearchFilters): { params: unknown[]; sql: string } {
  const { addParam, params, whereSql } = buildItemSearchQueryParts(filters);
  const limitPlaceholder = addParam(filters.limit);
  const offsetPlaceholder = addParam(filters.offset);

  const sql = `
    select
      ${itemSearchResultSelect}
    from active_item i
    where ${whereSql.join('\n      and ')}
    order by i.canonical_name asc, i.id asc
    limit ${limitPlaceholder}
    offset ${offsetPlaceholder}
  `;
  return { params, sql };
}
```

- [ ] **Step 4: Verify the service test passes**

Run:

```powershell
npm test -- src/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit service endpoint**

Run:

```powershell
git status --short
git add src/app.test.ts src/routes/catalog.ts
git commit -m "feat: add minimal item search results endpoint"
git push origin main
```

## Task 2: UI Minimal Loader

**Files:**
- Modify: `C:/PROJECTS/ludora/ludora-ui/src/app/utils/lightweightCatalogSource.test.mjs`
- Modify: `C:/PROJECTS/ludora/ludora-ui/src/app/api/catalog.ts`
- Modify: `C:/PROJECTS/ludora/ludora-ui/src/app/data/catalog.ts`

- [ ] **Step 1: Write the failing UI loader source test**

Update `src/app/utils/lightweightCatalogSource.test.mjs` so the first test expects the new endpoint and loader names:

```js
test("catalog api exposes minimal search results plus summary and filter-option endpoints", () => {
  const apiSource = source("../api/catalog.ts");
  const catalogSource = source("../data/catalog.ts");

  assert.match(apiSource, /\/api\/items\/search-results/);
  assert.match(apiSource, /\/api\/items\/summary/);
  assert.match(apiSource, /\/api\/items\/filter-options/);
  assert.match(catalogSource, /loadCatalogSearchResults/);
});
```

- [ ] **Step 2: Verify the UI loader test fails**

Run:

```powershell
npm test -- src/app/utils/lightweightCatalogSource.test.mjs
```

Expected: FAIL because `/api/items/search-results` and `loadCatalogSearchResults` do not exist.

- [ ] **Step 3: Add the API fetcher and data loader**

In `src/app/api/catalog.ts`, add:

```ts
export type ApiSearchResultItem = Pick<
  ApiItem,
  | "id"
  | "canonical_name"
  | "canonical_name_es"
  | "image_url"
  | "image_url_es"
  | "item_type"
  | "parent_item_id"
  | "is_expansion"
>;

export async function fetchSearchResults(query?: ApiItemsQuery): Promise<ApiSearchResultItem[]> {
  const suffix = itemSearchSuffix(query);

  return fetchData<ApiSearchResultItem[]>(`/api/items/search-results${suffix}`);
}
```

In `src/app/data/catalog.ts`, import `fetchSearchResults` and `type ApiSearchResultItem`, then add:

```ts
export type CatalogSearchResult = Game;

export async function loadCatalogSearchResults(query?: Parameters<typeof fetchSearchResults>[0]): Promise<CatalogSearchResult[]> {
  try {
    const items = await fetchSearchResults(query ?? { limit: 200 });
    return items.map((item) => mapApiItemToGame(item));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Verify the UI loader test passes**

Run:

```powershell
npm test -- src/app/utils/lightweightCatalogSource.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit UI loader**

Run:

```powershell
git status --short
git add src/app/api/catalog.ts src/app/data/catalog.ts src/app/utils/lightweightCatalogSource.test.mjs
git commit -m "feat: add minimal catalog search result loader"
git push origin main
```

## Task 3: Replace Summary Consumers

**Files:**
- Modify: `C:/PROJECTS/ludora/ludora-ui/src/app/utils/lightweightCatalogSource.test.mjs`
- Modify: `C:/PROJECTS/ludora/ludora-ui/src/app/pages/Search.tsx`
- Modify: `C:/PROJECTS/ludora/ludora-ui/src/app/components/SiteHeader.tsx`

- [ ] **Step 1: Write the failing consumer source tests**

Update the search page source test in `src/app/utils/lightweightCatalogSource.test.mjs`:

```js
test("search page uses minimal search results for grid results and lightweight filter options", () => {
  const searchSource = source("../pages/Search.tsx");

  assert.match(searchSource, /loadCatalogFilterOptions/);
  assert.match(searchSource, /loadCatalogSearchResults/);
  assert.doesNotMatch(searchSource, /loadCatalogGameSummaries/);
  assert.doesNotMatch(searchSource, /loadCatalogGameDetails/);
});
```

Add a header-specific assertion:

```js
test("site header autocomplete uses minimal search results", () => {
  const headerSource = source("../components/SiteHeader.tsx");

  assert.match(headerSource, /loadCatalogSearchResults/);
  assert.doesNotMatch(headerSource, /loadCatalogGameSummaries\(\{\s*query:\s*activeSearchQuery/);
});
```

- [ ] **Step 2: Verify the consumer tests fail**

Run:

```powershell
npm test -- src/app/utils/lightweightCatalogSource.test.mjs
```

Expected: FAIL because `Search.tsx` and `SiteHeader.tsx` still import and call `loadCatalogGameSummaries`.

- [ ] **Step 3: Replace the search page consumer**

In `src/app/pages/Search.tsx`, change imports:

```ts
  loadCatalogSearchResults,
  loadSemanticCatalogGameDetails,
  type CatalogFilterOptions,
  type CatalogSearchResult,
```

Change:

```ts
type SearchCatalogGame = GameDetail | CatalogGameSummary;
```

to:

```ts
type SearchCatalogGame = GameDetail | CatalogSearchResult;
```

Replace both regular search calls to `loadCatalogGameSummaries` with `loadCatalogSearchResults`.

Update `mapDetailToEnriched` so minimal regular results get display-safe defaults and rich semantic results keep filter data:

```ts
function mapDetailToEnriched(detail: SearchCatalogGame): EnrichedGame {
  const [min, max] = "players" in detail ? parseRange(detail.players) : [0, 0];
  const categories =
    "categoryEntries" in detail ? taxonomyEntriesFromDetail(detail, "categoryEntries", detail.categories) : [];
  const mechanics =
    "mechanicEntries" in detail ? taxonomyEntriesFromDetail(detail, "mechanicEntries", detail.mechanics) : [];

  return {
    id: detail.id,
    name: detail.name,
    altTitle: detail.altTitle,
    image: detail.image,
    isExpansion: detail.isExpansion,
    genres: detail.genres,
    categories,
    mechanics,
    categoryNames: categories.map((entry) => entry.name),
    mechanicNames: mechanics.map((entry) => entry.name),
    minPlayers: min,
    maxPlayers: max,
    playtime: "playTime" in detail ? playtimeBucket(detail.playTime) : "short",
    complexity: "complexity" in detail ? detail.complexity : 0,
  };
}
```

- [ ] **Step 4: Replace the header consumer**

In `src/app/components/SiteHeader.tsx`, change:

```ts
import { loadCatalogFilterOptions, loadCatalogGameSummaries } from "../data/catalog";
```

to:

```ts
import { loadCatalogFilterOptions, loadCatalogSearchResults } from "../data/catalog";
```

Change the autocomplete call:

```ts
loadCatalogSearchResults({ query: activeSearchQuery, limit: HOME_SEARCH_LIMIT })
```

- [ ] **Step 5: Verify the consumer tests pass**

Run:

```powershell
npm test -- src/app/utils/lightweightCatalogSource.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run full UI verification**

Run:

```powershell
npm test
npm run build
```

Expected: all tests pass and Vite build exits 0.

- [ ] **Step 7: Commit UI consumer replacement**

Run:

```powershell
git status --short
git add src/app/pages/Search.tsx src/app/components/SiteHeader.tsx src/app/utils/lightweightCatalogSource.test.mjs
git commit -m "feat: use minimal catalog search results"
git push origin main
```

## Task 4: Final Verification

**Files:**
- Read-only verification across `ludora-service` and `ludora-ui`.

- [ ] **Step 1: Run service verification**

Run from `C:/PROJECTS/ludora/ludora-service`:

```powershell
npm test
npm run build
git status --short --branch
```

Expected: tests pass, build exits 0, branch is clean and synced with `origin/main`.

- [ ] **Step 2: Run UI verification**

Run from `C:/PROJECTS/ludora/ludora-ui`:

```powershell
npm test
npm run build
git status --short --branch
```

Expected: tests pass, build exits 0, branch is clean and synced with `origin/main`.

- [ ] **Step 3: Report deployment status**

No DDL/DML is involved. If the user asks for deployment, use `C:/PROJECTS/ludora/docs/codex-deployment.md`.
