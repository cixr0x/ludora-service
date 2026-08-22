import { Router } from 'express';

import type { Database } from '../db.js';
import type { EmbeddingClient } from '../embeddings.js';
import { publicProductPath } from '../productRoutes.js';

type CatalogRouterOptions = {
  embeddingClient?: EmbeddingClient;
  embeddingModel?: string;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const MAX_SEMANTIC_DISTANCE = 0.62;

export function createCatalogRouter(database: Database, options: CatalogRouterOptions = {}): Router {
  const router = Router();
  const embeddingModel = options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;

  router.get('/front-page', async (_request, response, next) => {
    try {
      const result = await database.query(frontPageSql);
      response.json({ data: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items', async (request, response, next) => {
    try {
      const filters = itemSearchFiltersFromQuery(request.query);
      const query = buildItemsQuery(filters);
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

  router.get('/items/summary', async (request, response, next) => {
    try {
      const filters = itemSearchFiltersFromQuery(request.query);
      const query = buildItemSummaryQuery(filters);
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

  router.get('/items/prerender', async (request, response, next) => {
    try {
      const limit = integerQueryField(request.query.limit, 200, 1, 200);
      const offset = integerQueryField(request.query.offset, 0, 0, 100000);
      const result = await database.query(prerenderItemsSql, [limit, offset]);
      const rows = result.rows.map((row) => withCanonicalProductPath(row as Record<string, unknown>));

      response.json({
        data: rows,
        meta: {
          count: rows.length,
          limit,
          offset
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/filter-options', async (_request, response, next) => {
    try {
      const result = await database.query(catalogFilterOptionsSql);
      response.json({ data: result.rows[0] ?? { categories: [], mechanics: [] } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/semantic-search', async (request, response, next) => {
    try {
      const query = stringQueryField(request.query.q);
      if (!query) {
        throw httpError(400, 'q is required');
      }

      if (!options.embeddingClient) {
        throw httpError(503, 'Semantic search is not configured');
      }

      const limit = integerQueryField(request.query.limit, 20, 1, 100);
      const embedding = await options.embeddingClient.embed(query);
      const result = await database.query(semanticItemsSql, [
        vectorLiteral(embedding),
        embeddingModel,
        MAX_SEMANTIC_DISTANCE,
        limit
      ]);

      response.json({
        data: result.rows,
        meta: {
          count: result.rows.length,
          limit
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:id/stores', async (request, response, next) => {
    try {
      const itemId = integerPathParam(request.params.id);
      const result = await database.query(storeOffersSql, [itemId]);
      response.json({ data: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:id/canonical-route', async (request, response, next) => {
    try {
      const itemId = integerPathParam(request.params.id);
      const result = await database.query(canonicalProductRouteSql, [itemId]);
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        throw httpError(404, 'Item not found');
      }

      response.redirect(301, publicProductPath(row.id, row.canonical_name_es, row.canonical_name));
    } catch (error) {
      next(error);
    }
  });

  router.post('/store-items/:id/clicks', async (request, response, next) => {
    try {
      const storeItemId = integerPathParam(request.params.id);
      await database.query(storeItemClickSql, [storeItemId]);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:id/related', async (request, response, next) => {
    try {
      const itemId = integerPathParam(request.params.id);
      const limit = integerQueryField(request.query.limit, 18, 1, 50);
      const result = await database.query(relatedItemsSql, [itemId, limit]);

      response.json({
        data: result.rows,
        meta: {
          count: result.rows.length,
          limit
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:id/expansions', async (request, response, next) => {
    try {
      const itemId = integerPathParam(request.params.id);
      const limit = integerQueryField(request.query.limit, 18, 1, 50);
      const result = await database.query(itemExpansionsSql, [itemId, limit]);

      response.json({
        data: result.rows,
        meta: {
          count: result.rows.length,
          limit
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:id/taxonomy', async (request, response, next) => {
    try {
      const itemId = integerPathParam(request.params.id);
      const result = await database.query(itemTaxonomySql, [itemId]);
      response.json({ data: result.rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:id', async (request, response, next) => {
    try {
      const itemId = integerPathParam(request.params.id);
      const result = await database.query(itemDetailSql, [itemId]);
      const row = result.rows[0];
      if (!row) {
        throw httpError(404, 'Item not found');
      }

      response.json({ data: row });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

const itemSelect = `
  i.id,
  i.canonical_name,
  i.normalized_name,
  i.canonical_name_es,
  i.normalized_name_es,
  i.item_type,
  i.parent_item_id,
  i.bgg_id,
  i.bgg_url,
  i.bgg_last_sync_at,
  i.year_published,
  i.rating,
  i.description,
  i.description_es,
  i.min_players,
  i.max_players,
  i.min_minutes,
  i.max_minutes,
  i.complexity,
  i.min_age,
  i.image_url,
  i.image_url_es,
  i.status,
  i.has_approved_listing,
  i.is_expansion,
  i.created_at,
  i.updated_at
`;

const itemSummarySelect = `
  i.id,
  i.canonical_name,
  i.canonical_name_es,
  i.item_type,
  i.parent_item_id,
  i.year_published,
  i.rating,
  i.min_players,
  i.max_players,
  i.min_minutes,
  i.max_minutes,
  i.complexity,
  i.image_url,
  i.image_url_es,
  i.has_approved_listing,
  i.is_expansion
`;

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

const prerenderItemSelect = `
  i.id,
  i.canonical_name,
  i.canonical_name_es,
  i.item_type,
  i.parent_item_id,
  i.bgg_id,
  i.bgg_url,
  i.year_published,
  i.rating,
  i.description,
  i.description_es,
  i.min_players,
  i.max_players,
  i.min_minutes,
  i.max_minutes,
  i.complexity,
  i.min_age,
  i.image_url,
  i.image_url_es,
  i.is_expansion,
  i.updated_at
`;

const relatedItemSelect = `
  i.id,
  i.canonical_name,
  i.canonical_name_es,
  i.image_url,
  i.image_url_es
`;

const taxonomyLateralSql = `
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bc.id,
          'bgg_id', bc.bgg_id,
          'name', bc.name,
          'name_es', bc.name_es
        )
        order by bc.name asc, bc.id asc
      ),
      '[]'::jsonb
    ) as categories
    from item_categories ic
    join boardgame_categories bc on bc.id = ic.category_id
    where ic.item_id = i.id
  ) categories on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bm.id,
          'bgg_id', bm.bgg_id,
          'name', bm.name,
          'name_es', bm.name_es
        )
        order by bm.name asc, bm.id asc
      ),
      '[]'::jsonb
    ) as mechanics
    from item_mechanics im
    join boardgame_mechanics bm on bm.id = im.mechanic_id
    where im.item_id = i.id
  ) mechanics on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bf.id,
          'bgg_id', bf.bgg_id,
          'name', bf.name,
          'name_es', bf.name_es
        )
        order by bf.name asc, bf.id asc
      ),
      '[]'::jsonb
    ) as families
    from item_families ifa
    join boardgame_families bf on bf.id = ifa.family_id
    where ifa.item_id = i.id
  ) families on true
`;

const summaryTaxonomyLateralSql = `
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bc.id,
          'bgg_id', bc.bgg_id,
          'name', bc.name,
          'name_es', bc.name_es
        )
        order by bc.name asc, bc.id asc
      ),
      '[]'::jsonb
    ) as categories
    from item_categories ic
    join boardgame_categories bc on bc.id = ic.category_id
    where ic.item_id = i.id
  ) categories on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bm.id,
          'bgg_id', bm.bgg_id,
          'name', bm.name,
          'name_es', bm.name_es
        )
        order by bm.name asc, bm.id asc
      ),
      '[]'::jsonb
    ) as mechanics
    from item_mechanics im
    join boardgame_mechanics bm on bm.id = im.mechanic_id
    where im.item_id = i.id
  ) mechanics on true
`;

const publicMetadataLateralSql = `
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'bgg_id', c.bgg_id,
          'name', c.name
        )
        order by c.name asc, c.id asc
      ),
      '[]'::jsonb
    ) as designers
    from item_contributors ic
    join contributors c on c.id = ic.contributor_id
    where ic.item_id = i.id
      and ic.contribution_role = 'designer'
  ) designers on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'bgg_id', p.bgg_id,
          'name', p.name,
          'website_url', p.website_url
        )
        order by p.name asc, p.id asc
      ),
      '[]'::jsonb
    ) as publishers
    from item_publishers ip
    join publishers p on p.id = ip.publisher_id
    where ip.item_id = i.id
  ) publishers on true
`;

const parentItemsLateralSql = `
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', parent_item.id,
          'canonical_name', parent_item.canonical_name,
          'canonical_name_es', parent_item.canonical_name_es
        )
        order by coalesce(parent_item.canonical_name_es, parent_item.canonical_name) asc, parent_item.id asc
      ),
      '[]'::jsonb
    ) as parent_items
    from (
      select distinct parent.id, parent.canonical_name, parent.canonical_name_es
      from active_item parent
      where parent.has_approved_listing = true
        and (
          parent.id = i.parent_item_id
          or exists (
            select 1
            from item_relationships relationship
            where (
              relationship.link_type = 'extension'
              and relationship.item_a_id = i.id
              and relationship.item_b_id = parent.id
            )
            or (
              relationship.link_type = 'expansion'
              and relationship.item_b_id = i.id
              and relationship.item_a_id = parent.id
            )
          )
        )
    ) parent_item
  ) parent_items on true
`;

const tutorialLateralSql = `
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tl.id,
          'url', tl.url,
          'title', tl.title,
          'language', tl.language,
          'source', tl.source,
          'status', tl.status
        )
        order by tl.tutorial_scope asc, tl.created_at desc, tl.id desc
      ),
      '[]'::jsonb
    ) as tutorials
    from (
      select tl.*, 0 as tutorial_scope
      from tutorial_links tl
      where tl.item_id = i.id
        and tl.status = 'published'

      union all

      select tl.*, 1 as tutorial_scope
      from tutorial_links tl
      where i.is_expansion = true
        and i.parent_item_id is not null
        and tl.item_id = i.parent_item_id
        and tl.status = 'published'
        and not exists (
          select 1
          from tutorial_links direct_tutorial
          where direct_tutorial.item_id = i.id
            and direct_tutorial.status = 'published'
            and direct_tutorial.source = tl.source
        )
    ) tl
  ) tutorials on true
`;

const itemOffersLateralSql = `
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', si.id,
          'store_id', s.id,
          'store_name', s.name,
          'store_platform', s.platform,
          'store_domain', s.canonical_domain,
          'store_website_url', s.website_url,
          'store_logo_url', s.logo_url,
          'store_country', s.country,
          'source_url', si.source_url,
          'source_listing_url', si.source_listing_url,
          'game_title', si.title,
          'image_url', si.image_url,
          'price', si.price,
          'raw_price', si.raw_price,
          'currency', si.currency,
          'availability', si.availability,
          'store_active', si.store_active,
          'listing_status', si.listing_status,
          'is_bundle', exists (
            select 1
            from store_item_additional_items bundle_item
            where bundle_item.store_item_id = si.id
          ),
          'last_seen_at', si.last_seen_at
        )
        order by
          case
            when si.store_active = false then 2
            when lower(coalesce(si.availability, '')) in (
              'out_of_stock', 'outofstock', 'sold_out', 'soldout', 'sold-out',
              'agotado', 'sin_stock', 'sin stock', 'unavailable', 'no_disponible', 'no disponible'
            ) then 1
            else 0
          end,
          si.price asc nulls last,
          s.name asc,
          si.id asc
      ),
      '[]'::jsonb
    ) as offers
    from store_items si
    join stores s on s.id = si.store_id
    where (
      si.item_id = i.id
      or exists (
        select 1
        from store_item_additional_items siai
        where siai.store_item_id = si.id
          and siai.item_id = i.id
      )
    )
      and si.is_boardgame = true
      and si.is_boardgame_confirmed = true
      and si.listing_status = 'LISTED'
  ) offers on true
`;

const frontPageSql = `
  select
    fpc.id,
    fpc.category_type,
    fpc.category_id,
    fpc.title,
    fpc.title_display,
    fpc."order",
    coalesce(bc.name, bf.name, bm.name, '') as category_name,
    coalesce(bc.name_es, bf.name_es, bm.name_es, '') as category_name_es,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'canonical_name', i.canonical_name,
          'canonical_name_es', i.canonical_name_es,
          'image_url', i.image_url,
          'image_url_es', i.image_url_es
        )
        order by i.rating desc nulls last, fpci.item_order asc, i.canonical_name asc, i.id asc
      ) filter (where i.id is not null),
      '[]'::jsonb
    ) as products
  from front_page_categories fpc
  left join boardgame_categories bc on fpc.category_type = 'category' and bc.id = fpc.category_id
  left join boardgame_families bf on fpc.category_type = 'family' and bf.id = fpc.category_id
  left join boardgame_mechanics bm on fpc.category_type = 'mechanic' and bm.id = fpc.category_id
  left join front_page_category_items fpci on fpci.front_page_category_id = fpc.id
  left join active_item i on i.id = fpci.item_id
  group by fpc.id, bc.name, bc.name_es, bf.name, bf.name_es, bm.name, bm.name_es
  order by fpc."order" asc, fpc.id asc
`;

type ItemSearchFilters = {
  categoryIds: number[];
  complexityMax?: number;
  complexityMin?: number;
  durationMax?: number;
  durationMin?: number;
  limit: number;
  mechanicIds: number[];
  offset: number;
  players?: number;
  query: string;
};

type ItemSearchQueryParts = {
  addParam(value: unknown): string;
  params: unknown[];
  whereSql: string[];
};

function buildItemSearchQueryParts(filters: ItemSearchFilters): ItemSearchQueryParts {
  const params: unknown[] = [];
  const whereSql: string[] = ['i.has_approved_listing = true'];
  const searchableTitleSql =
    "concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es)";

  function addParam(value: unknown): string {
    params.push(value);
    return `$${params.length}`;
  }

  if (filters.query) {
    for (const term of searchTerms(filters.query)) {
      const queryPlaceholder = addParam(likePattern(term));
      whereSql.push(`${searchableTitleSql} ilike ${queryPlaceholder} escape '\\'`);
    }
  }

  if (filters.players !== undefined) {
    const playersPlaceholder = addParam(filters.players);
    whereSql.push(`coalesce(i.min_players, i.max_players) <= ${playersPlaceholder}`);
    whereSql.push(`coalesce(i.max_players, i.min_players) >= ${playersPlaceholder}`);
  }

  if (filters.durationMin !== undefined) {
    const durationMinPlaceholder = addParam(filters.durationMin);
    whereSql.push(`coalesce(i.max_minutes, i.min_minutes) >= ${durationMinPlaceholder}`);
  }

  if (filters.durationMax !== undefined) {
    const durationMaxPlaceholder = addParam(filters.durationMax);
    whereSql.push(`coalesce(i.min_minutes, i.max_minutes) <= ${durationMaxPlaceholder}`);
  }

  if (filters.complexityMin !== undefined) {
    whereSql.push(`i.complexity >= ${addParam(filters.complexityMin)}`);
  }

  if (filters.complexityMax !== undefined) {
    whereSql.push(`i.complexity <= ${addParam(filters.complexityMax)}`);
  }

  if (filters.categoryIds.length > 0) {
    const categoryIdsPlaceholder = addParam(filters.categoryIds);
    whereSql.push(`(
      select count(distinct ic.category_id)
      from item_categories ic
      where ic.item_id = i.id
        and ic.category_id = any(${categoryIdsPlaceholder}::bigint[])
    ) = cardinality(${categoryIdsPlaceholder}::bigint[])`);
  }

  if (filters.mechanicIds.length > 0) {
    const mechanicIdsPlaceholder = addParam(filters.mechanicIds);
    whereSql.push(`(
      select count(distinct im.mechanic_id)
      from item_mechanics im
      where im.item_id = i.id
        and im.mechanic_id = any(${mechanicIdsPlaceholder}::bigint[])
    ) = cardinality(${mechanicIdsPlaceholder}::bigint[])`);
  }

  return { addParam, params, whereSql };
}

function buildItemsQuery(filters: ItemSearchFilters): { params: unknown[]; sql: string } {
  const { addParam, params, whereSql } = buildItemSearchQueryParts(filters);
  const limitPlaceholder = addParam(filters.limit);
  const offsetPlaceholder = addParam(filters.offset);

  const sql = `
    select
      ${itemSelect},
      coalesce(categories.categories, '[]'::jsonb) as categories,
      coalesce(mechanics.mechanics, '[]'::jsonb) as mechanics,
      coalesce(families.families, '[]'::jsonb) as families,
      coalesce(designers.designers, '[]'::jsonb) as designers,
      coalesce(publishers.publishers, '[]'::jsonb) as publishers
    from active_item i
    ${taxonomyLateralSql}
    ${publicMetadataLateralSql}
    where ${whereSql.join('\n      and ')}
    order by i.canonical_name asc, i.id asc
    limit ${limitPlaceholder}
    offset ${offsetPlaceholder}
  `;
  return { params, sql };
}

function buildItemSummaryQuery(filters: ItemSearchFilters): { params: unknown[]; sql: string } {
  const { addParam, params, whereSql } = buildItemSearchQueryParts(filters);
  const limitPlaceholder = addParam(filters.limit);
  const offsetPlaceholder = addParam(filters.offset);

  const sql = `
    select
      ${itemSummarySelect},
      coalesce(categories.categories, '[]'::jsonb) as categories,
      coalesce(mechanics.mechanics, '[]'::jsonb) as mechanics
    from active_item i
    ${summaryTaxonomyLateralSql}
    where ${whereSql.join('\n      and ')}
    order by i.canonical_name asc, i.id asc
    limit ${limitPlaceholder}
    offset ${offsetPlaceholder}
  `;
  return { params, sql };
}

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

const catalogFilterOptionsSql = `
  select
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', category_options.id,
            'bgg_id', category_options.bgg_id,
            'name', category_options.name,
            'name_es', category_options.name_es
          )
          order by category_options.name asc, category_options.id asc
        )
        from (
          select distinct bc.id, bc.bgg_id, bc.name, bc.name_es
          from item_categories ic
          join active_item i on i.id = ic.item_id
          join boardgame_categories bc on bc.id = ic.category_id
          where i.has_approved_listing = true
        ) category_options
      ),
      '[]'::jsonb
    ) as categories,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', mechanic_options.id,
            'bgg_id', mechanic_options.bgg_id,
            'name', mechanic_options.name,
            'name_es', mechanic_options.name_es
          )
          order by mechanic_options.name asc, mechanic_options.id asc
        )
        from (
          select distinct bm.id, bm.bgg_id, bm.name, bm.name_es
          from item_mechanics im
          join active_item i on i.id = im.item_id
          join boardgame_mechanics bm on bm.id = im.mechanic_id
          where i.has_approved_listing = true
        ) mechanic_options
      ),
      '[]'::jsonb
    ) as mechanics
`;

const semanticItemsSql = `
  select
    ${itemSelect},
    coalesce(categories.categories, '[]'::jsonb) as categories,
    coalesce(mechanics.mechanics, '[]'::jsonb) as mechanics,
    coalesce(families.families, '[]'::jsonb) as families,
    coalesce(designers.designers, '[]'::jsonb) as designers,
    coalesce(publishers.publishers, '[]'::jsonb) as publishers,
    (ise.embedding <=> $1::vector) as semantic_distance
  from item_search_embeddings ise
  join active_item i on i.id = ise.item_id
  ${taxonomyLateralSql}
  ${publicMetadataLateralSql}
  where ise.model = $2
    and i.has_approved_listing = true
    and (ise.embedding <=> $1::vector) <= $3
  order by ise.embedding <=> $1::vector asc, i.canonical_name asc, i.id asc
  limit $4
`;

const itemDetailSql = `
  select
    ${itemSelect},
    coalesce(categories.categories, '[]'::jsonb) as categories,
    coalesce(mechanics.mechanics, '[]'::jsonb) as mechanics,
    coalesce(families.families, '[]'::jsonb) as families,
    coalesce(designers.designers, '[]'::jsonb) as designers,
    coalesce(publishers.publishers, '[]'::jsonb) as publishers,
    coalesce(parent_items.parent_items, '[]'::jsonb) as parent_items,
    coalesce(tutorials.tutorials, '[]'::jsonb) as tutorials,
    coalesce(offers.offers, '[]'::jsonb) as offers
  from active_item i
  ${taxonomyLateralSql}
  ${publicMetadataLateralSql}
  ${parentItemsLateralSql}
  ${tutorialLateralSql}
  ${itemOffersLateralSql}
  where i.id = $1
`;

const prerenderItemsSql = `
  with prerender_page as (
    select ${prerenderItemSelect}
    from active_item i
    where i.has_approved_listing = true
    order by i.canonical_name asc, i.id asc
    limit $1
    offset $2
  )
  select
    i.*,
    coalesce(categories.categories, '[]'::jsonb) as categories,
    coalesce(mechanics.mechanics, '[]'::jsonb) as mechanics,
    coalesce(families.families, '[]'::jsonb) as families,
    coalesce(designers.designers, '[]'::jsonb) as designers,
    coalesce(publishers.publishers, '[]'::jsonb) as publishers,
    coalesce(parent_items.parent_items, '[]'::jsonb) as parent_items
  from prerender_page i
  ${taxonomyLateralSql}
  ${publicMetadataLateralSql}
  ${parentItemsLateralSql}
  order by i.canonical_name asc, i.id asc
`;

const canonicalProductRouteSql = `
  select i.id, i.canonical_name, i.canonical_name_es
  from active_item i
  where i.id = $1
    and i.has_approved_listing = true
`;

const storeOffersSql = `
  select
    si.id,
    si.store_id,
    s.name as store_name,
    s.platform as store_platform,
    s.canonical_domain as store_domain,
    s.website_url as store_website_url,
    s.logo_url as store_logo_url,
    s.country as store_country,
    si.source_url,
    si.source_listing_url,
    si.title as game_title,
    si.image_url,
    si.price,
    si.raw_price,
    si.currency,
    si.availability,
    si.store_active,
    si.listing_status,
    exists (
      select 1
      from store_item_additional_items bundle_item
      where bundle_item.store_item_id = si.id
    ) as is_bundle,
    si.last_seen_at
  from store_items si
  join stores s on s.id = si.store_id
  where (
    si.item_id = $1
    or exists (
      select 1
      from store_item_additional_items siai
      where siai.store_item_id = si.id
        and siai.item_id = $1
    )
  )
    and si.is_boardgame = true
    and si.is_boardgame_confirmed = true
    and si.listing_status = 'LISTED'
  order by
    case
      when si.store_active = false then 2
      when lower(coalesce(si.availability, '')) in (
        'out_of_stock', 'outofstock', 'sold_out', 'soldout', 'sold-out',
        'agotado', 'sin_stock', 'sin stock', 'unavailable', 'no_disponible', 'no disponible'
      ) then 1
      else 0
    end,
    si.price asc nulls last,
    s.name asc
`;

const storeItemClickSql = `
  insert into store_item_click_stats (store_item_id, clicked_hour, click_count)
  values ($1, date_trunc('hour', now()), 1)
  on conflict (store_item_id, clicked_hour)
  do update set click_count = store_item_click_stats.click_count + 1
`;

const relatedItemsSql = `
  with target_taxonomy as (
    select 'category' as taxonomy_type, ic.category_id as taxonomy_id
    from item_categories ic
    where ic.item_id = $1

    union all

    select 'mechanic' as taxonomy_type, im.mechanic_id as taxonomy_id
    from item_mechanics im
    where im.item_id = $1

    union all

    select 'family' as taxonomy_type, ifa.family_id as taxonomy_id
    from item_families ifa
    where ifa.item_id = $1
  ),
  candidate_taxonomy as (
    select ic.item_id, 'category' as taxonomy_type, ic.category_id as taxonomy_id
    from item_categories ic

    union all

    select im.item_id, 'mechanic' as taxonomy_type, im.mechanic_id as taxonomy_id
    from item_mechanics im

    union all

    select ifa.item_id, 'family' as taxonomy_type, ifa.family_id as taxonomy_id
    from item_families ifa
  ),
  related_scores as (
    select ct.item_id, count(*) as shared_taxonomy_count
    from candidate_taxonomy ct
    join target_taxonomy tt on tt.taxonomy_type = ct.taxonomy_type and tt.taxonomy_id = ct.taxonomy_id
    where ct.item_id <> $1
    group by ct.item_id
  )
  select
    ${relatedItemSelect}
  from related_scores rs
  join active_item i on i.id = rs.item_id
  where i.has_approved_listing = true
    and i.is_expansion = false
    and i.item_type = 'base_game'
    and i.parent_item_id is null
  order by rs.shared_taxonomy_count desc, i.rating desc nulls last, i.canonical_name asc, i.id asc
  limit $2
`;

const itemExpansionsSql = `
  select
    ${relatedItemSelect}
  from active_item i
  where (
    i.parent_item_id = $1
    or exists (
      select 1
      from item_relationships relationship
      where (
        relationship.link_type = 'extension'
        and relationship.item_a_id = i.id
        and relationship.item_b_id = $1
      )
      or (
        relationship.link_type = 'expansion'
        and relationship.item_b_id = i.id
        and relationship.item_a_id = $1
      )
    )
  )
    and i.is_expansion = true
    and i.item_type = 'expansion'
    and i.has_approved_listing = true
  order by i.rating desc nulls last, i.canonical_name asc, i.id asc
  limit $2
`;

const itemTaxonomySql = `
  select $1::bigint as item_id,
    coalesce(categories.categories, '[]'::jsonb) as categories,
    coalesce(mechanics.mechanics, '[]'::jsonb) as mechanics,
    coalesce(families.families, '[]'::jsonb) as families,
    coalesce(designers.designers, '[]'::jsonb) as designers,
    coalesce(publishers.publishers, '[]'::jsonb) as publishers
  from (select 1) anchor
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bc.id,
          'bgg_id', bc.bgg_id,
          'name', bc.name,
          'name_es', bc.name_es
        )
        order by bc.name asc, bc.id asc
      ),
      '[]'::jsonb
    ) as categories
    from item_categories ic
    join boardgame_categories bc on bc.id = ic.category_id
    where ic.item_id = $1
  ) categories on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bm.id,
          'bgg_id', bm.bgg_id,
          'name', bm.name,
          'name_es', bm.name_es
        )
        order by bm.name asc, bm.id asc
      ),
      '[]'::jsonb
    ) as mechanics
    from item_mechanics im
    join boardgame_mechanics bm on bm.id = im.mechanic_id
    where im.item_id = $1
  ) mechanics on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', bf.id,
          'bgg_id', bf.bgg_id,
          'name', bf.name,
          'name_es', bf.name_es
        )
        order by bf.name asc, bf.id asc
      ),
      '[]'::jsonb
    ) as families
    from item_families ifa
    join boardgame_families bf on bf.id = ifa.family_id
    where ifa.item_id = $1
  ) families on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'bgg_id', c.bgg_id,
          'name', c.name
        )
        order by c.name asc, c.id asc
      ),
      '[]'::jsonb
    ) as designers
    from item_contributors ic
    join contributors c on c.id = ic.contributor_id
    where ic.item_id = $1
      and ic.contribution_role = 'designer'
  ) designers on true
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'bgg_id', p.bgg_id,
          'name', p.name,
          'website_url', p.website_url
        )
        order by p.name asc, p.id asc
      ),
      '[]'::jsonb
    ) as publishers
    from item_publishers ip
    join publishers p on p.id = ip.publisher_id
    where ip.item_id = $1
  ) publishers on true
`;

function stringQueryField(value: unknown): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue).trim() : '';
}

function withCanonicalProductPath(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    canonical_path: publicProductPath(row.id, row.canonical_name_es, row.canonical_name)
  };
}

function integerQueryField(value: unknown, fallback: number, min: number, max: number): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = typeof rawValue === 'string' || typeof rawValue === 'number' ? Number(rawValue) : NaN;
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function itemSearchFiltersFromQuery(query: Record<string, unknown>): ItemSearchFilters {
  const filters: ItemSearchFilters = {
    categoryIds: positiveIntegerListQueryField(query.category_ids, 'category_ids'),
    complexityMax: optionalNumberQueryField(query.complexity_max, 'complexity_max', 0, 5),
    complexityMin: optionalNumberQueryField(query.complexity_min, 'complexity_min', 0, 5),
    durationMax: optionalIntegerQueryField(query.duration_max, 'duration_max', 0, 100000),
    durationMin: optionalIntegerQueryField(query.duration_min, 'duration_min', 0, 100000),
    limit: integerQueryField(query.limit, 100, 1, 200),
    mechanicIds: positiveIntegerListQueryField(query.mechanic_ids, 'mechanic_ids'),
    offset: integerQueryField(query.offset, 0, 0, 100000),
    players: optionalIntegerQueryField(query.players, 'players', 1, 100),
    query: stringQueryField(query.q)
  };

  if (
    filters.durationMin !== undefined &&
    filters.durationMax !== undefined &&
    filters.durationMin > filters.durationMax
  ) {
    throw httpError(400, 'duration_min must be less than or equal to duration_max');
  }

  if (
    filters.complexityMin !== undefined &&
    filters.complexityMax !== undefined &&
    filters.complexityMin > filters.complexityMax
  ) {
    throw httpError(400, 'complexity_min must be less than or equal to complexity_max');
  }

  return filters;
}

function optionalIntegerQueryField(value: unknown, fieldName: string, min: number, max: number): number | undefined {
  const rawValue = firstQueryValue(value);
  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw httpError(400, `${fieldName} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function optionalNumberQueryField(value: unknown, fieldName: string, min: number, max: number): number | undefined {
  const rawValue = firstQueryValue(value);
  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw httpError(400, `${fieldName} must be a number between ${min} and ${max}`);
  }

  return parsed;
}

function positiveIntegerListQueryField(value: unknown, fieldName: string): number[] {
  const rawValues = Array.isArray(value) ? value : [value];
  const parsedValues = rawValues
    .flatMap((rawValue) => String(rawValue ?? '').split(','))
    .map((rawValue) => rawValue.trim())
    .filter(Boolean)
    .map((rawValue) => Number(rawValue));

  if (!parsedValues.every((parsedValue) => Number.isInteger(parsedValue) && parsedValue > 0)) {
    throw httpError(400, `${fieldName} must contain positive integers`);
  }

  return Array.from(new Set(parsedValues));
}

function firstQueryValue(value: unknown): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }
  if (typeof rawValue === 'string' || typeof rawValue === 'number') {
    return String(rawValue).trim();
  }
  return undefined;
}

function integerPathParam(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw httpError(400, 'id must be a positive integer');
  }

  return parsed;
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function searchTerms(value: string): string[] {
  return Array.from(new Set(value.split(/\s+/).map((term) => term.trim()).filter(Boolean)));
}

function vectorLiteral(values: number[]): string {
  if (values.length === 0) {
    throw new Error('Embedding cannot be empty');
  }

  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding must contain finite numbers');
    }
  }

  return `[${values.join(',')}]`;
}

function httpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}
