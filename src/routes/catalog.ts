import { Router } from 'express';

import type { Database } from '../db.js';
import type { EmbeddingClient } from '../embeddings.js';

type CatalogRouterOptions = {
  embeddingClient?: EmbeddingClient;
  embeddingModel?: string;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

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
      const query = stringQueryField(request.query.q);
      const limit = integerQueryField(request.query.limit, 100, 1, 200);
      const offset = integerQueryField(request.query.offset, 0, 0, 100000);
      const params = query ? [likePattern(query), limit, offset] : [limit, offset];
      const result = await database.query(itemsSql(Boolean(query)), params);

      response.json({
        data: result.rows,
        meta: {
          count: result.rows.length,
          limit,
          offset
        }
      });
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
      const result = await database.query(semanticItemsSql, [vectorLiteral(embedding), embeddingModel, limit]);

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
        order by tl.created_at desc, tl.id desc
      ),
      '[]'::jsonb
    ) as tutorials
    from tutorial_links tl
    where tl.item_id = i.id
      and tl.status = 'published'
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
          'listing_status', si.listing_status,
          'last_seen_at', si.last_seen_at
        )
        order by si.price asc nulls last, s.name asc, si.id asc
      ),
      '[]'::jsonb
    ) as offers
    from store_items si
    join stores s on s.id = si.store_id
    where si.item_id = i.id
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
          'image_url_es', i.image_url_es,
          'item_type', i.item_type,
          'year_published', i.year_published,
          'rating', i.rating,
          'min_players', i.min_players,
          'max_players', i.max_players,
          'min_minutes', i.min_minutes,
          'max_minutes', i.max_minutes,
          'complexity', i.complexity,
          'has_approved_listing', i.has_approved_listing,
          'is_expansion', i.is_expansion
        )
        order by fpci.item_order asc, i.canonical_name asc, i.id asc
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

function itemsSql(hasSearch: boolean): string {
  const whereSql = hasSearch
    ? `
      where concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es) ilike $1 escape '\\'
    `
    : '';
  const limitPlaceholder = hasSearch ? '$2' : '$1';
  const offsetPlaceholder = hasSearch ? '$3' : '$2';

  return `
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
    ${whereSql}
    order by i.canonical_name asc, i.id asc
    limit ${limitPlaceholder}
    offset ${offsetPlaceholder}
  `;
}

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
  order by ise.embedding <=> $1::vector asc, i.canonical_name asc, i.id asc
  limit $3
`;

const itemDetailSql = `
  select
    ${itemSelect},
    coalesce(categories.categories, '[]'::jsonb) as categories,
    coalesce(mechanics.mechanics, '[]'::jsonb) as mechanics,
    coalesce(families.families, '[]'::jsonb) as families,
    coalesce(designers.designers, '[]'::jsonb) as designers,
    coalesce(publishers.publishers, '[]'::jsonb) as publishers,
    coalesce(tutorials.tutorials, '[]'::jsonb) as tutorials,
    coalesce(offers.offers, '[]'::jsonb) as offers
  from active_item i
  ${taxonomyLateralSql}
  ${publicMetadataLateralSql}
  ${tutorialLateralSql}
  ${itemOffersLateralSql}
  where i.id = $1
`;

const storeOffersSql = `
  select
    si.id,
    si.store_id,
    s.name as store_name,
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
    si.listing_status,
    si.last_seen_at
  from store_items si
  join stores s on s.id = si.store_id
  where si.item_id = $1
    and si.is_boardgame = true
    and si.is_boardgame_confirmed = true
    and si.listing_status = 'LISTED'
  order by si.price asc nulls last, s.name asc
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

function integerQueryField(value: unknown, fallback: number, min: number, max: number): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = typeof rawValue === 'string' || typeof rawValue === 'number' ? Number(rawValue) : NaN;
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
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
