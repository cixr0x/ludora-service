import type { Database } from '../db.js';

type ExportRow = Record<string, unknown>;

export function exportCursor(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw Object.assign(new Error(`${name} must be a nonnegative safe integer`), { status: 400 });
  }
  return Number(value);
}

export async function exportMaxId(database: Database): Promise<number> {
  const result = await database.query(`
    select coalesce(max(i.id), 0) as max_id from active_item i where i.has_approved_listing = true
  `);
  const maxId = Number((result.rows[0] as ExportRow | undefined)?.max_id);
  if (!Number.isSafeInteger(maxId) || maxId < 0) throw new Error('Invalid export maximum ID');
  return maxId;
}

export function validateExportRows(rows: unknown[], limit: number, maxId: number, afterId?: number): ExportRow[] {
  if (rows.length > limit) throw new Error('Export page exceeds requested limit');
  const ids = new Set<number>();
  let previous = afterId;
  return rows.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid export record');
    const row = value as ExportRow;
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id <= 0 || id > maxId || ids.has(id) ||
      (previous !== undefined && id <= previous) || typeof row.canonical_name !== 'string' || !row.canonical_name.trim()) {
      throw new Error('Invalid, duplicate, or non-advancing export record');
    }
    ids.add(id);
    if (afterId !== undefined) previous = id;
    return row;
  });
}

// One query per supporting data set, regardless of the number of games in the page.
// Query sequentially to keep the public VM's database and memory demand bounded.
export async function enrichExportRows(database: Database, rows: ExportRow[], maxId: number): Promise<ExportRow[]> {
  if (!rows.length) return [];
  const ids = rows.map(row => Number(row.id));
  const offers = await database.query(exportOffersSql, [ids]);
  const related = await database.query(exportRelatedSql, [ids, maxId, 18]);
  const expansions = await database.query(exportExpansionsSql, [ids, maxId, 18]);
  const group = (values: unknown[]) => {
    const result = new Map<number, ExportRow[]>();
    for (const value of values) {
      const { item_id, ...entry } = value as ExportRow;
      const id = Number(item_id);
      if (!ids.includes(id)) throw new Error('Unexpected supporting export item');
      const list = result.get(id) ?? [];
      list.push(entry);
      result.set(id, list);
    }
    return result;
  };
  const offersById = group(offers.rows);
  const relatedById = group(related.rows);
  const expansionsById = group(expansions.rows);
  return rows.map(row => ({
    ...row,
    offers: offersById.get(Number(row.id)) ?? [],
    related_items: relatedById.get(Number(row.id)) ?? [],
    expansion_items: expansionsById.get(Number(row.id)) ?? []
  }));
}

const exportOffersSql = `
  with offer_membership as (
    select si.item_id, si.id as store_item_id from store_items si where si.item_id = any($1::bigint[])
    union
    select extra.item_id, extra.store_item_id from store_item_additional_items extra where extra.item_id = any($1::bigint[])
  )
  select membership.item_id, si.id, s.id as store_id, s.name as store_name, s.platform as store_platform,
    s.canonical_domain as store_domain, s.website_url as store_website_url, s.logo_url as store_logo_url,
    s.country as store_country, s.updated_at as store_updated_at,
    si.source_url, si.source_listing_url, si.title as game_title, si.image_url,
    si.price, si.raw_price, si.currency, si.availability, si.store_active, si.listing_status, si.language,
    si.last_seen_at, si.last_updated, si.refreshed_date,
    exists (select 1 from store_item_additional_items bundle_item where bundle_item.store_item_id = si.id) as is_bundle
  from offer_membership membership
  join store_items si on si.id = membership.store_item_id
  join stores s on s.id = si.store_id
  where si.is_boardgame = true and si.is_boardgame_confirmed = true and si.listing_status = 'LISTED'
      and si.store_active = true
  order by membership.item_id,
    case when lower(coalesce(si.availability, '')) in ('unavailable', 'no_disponible', 'no disponible') then 2
      when lower(coalesce(si.availability, '')) in (
        'out_of_stock', 'outofstock', 'sold_out', 'soldout', 'sold-out',
        'agotado', 'sin_stock', 'sin stock'
      ) then 1 else 0 end,
    si.price asc nulls last, s.name asc, si.id asc
`;

// The same category/mechanic/family score and tie-breaks as GET /items/:id/related.
const exportRelatedSql = `
  with target_taxonomy as (
    select ic.item_id, 'category' as taxonomy_type, ic.category_id as taxonomy_id
    from item_categories ic where ic.item_id = any($1::bigint[])
    union all
    select im.item_id, 'mechanic', im.mechanic_id from item_mechanics im where im.item_id = any($1::bigint[])
    union all
    select ifa.item_id, 'family', ifa.family_id from item_families ifa where ifa.item_id = any($1::bigint[])
  ), candidate_taxonomy as (
    select ic.item_id, 'category' as taxonomy_type, ic.category_id as taxonomy_id from item_categories ic
    union all
    select im.item_id, 'mechanic', im.mechanic_id from item_mechanics im
    union all
    select ifa.item_id, 'family', ifa.family_id from item_families ifa
  ), related_scores as (
    select tt.item_id, ct.item_id as candidate_id, count(*) as shared_taxonomy_count
    from target_taxonomy tt
    join candidate_taxonomy ct on ct.taxonomy_type = tt.taxonomy_type and ct.taxonomy_id = tt.taxonomy_id
    where ct.item_id <> tt.item_id
    group by tt.item_id, ct.item_id
  ), ranked as (
    select rs.item_id, i.id, i.canonical_name, i.canonical_name_es, i.image_url, i.image_url_es,
      row_number() over (partition by rs.item_id order by rs.shared_taxonomy_count desc,
        i.rating desc nulls last, i.canonical_name asc, i.id asc) as position
    from related_scores rs join active_item i on i.id = rs.candidate_id
    where i.has_approved_listing = true and i.is_expansion = false and i.item_type = 'base_game'
      and i.parent_item_id is null and i.id <= $2
  )
  select item_id, id, canonical_name, canonical_name_es, image_url, image_url_es
  from ranked where position <= $3 order by item_id, position
`;

// Preserve both legacy parent IDs and both existing relationship directions.
const exportExpansionsSql = `
  with membership as (
    select i.parent_item_id as item_id, i.id as expansion_id from active_item i where i.parent_item_id = any($1::bigint[])
    union
    select item_b_id, item_a_id from item_relationships where link_type = 'extension' and item_b_id = any($1::bigint[])
    union
    select item_a_id, item_b_id from item_relationships where link_type = 'expansion' and item_a_id = any($1::bigint[])
  ), ranked as (
    select membership.item_id, i.id, i.canonical_name, i.canonical_name_es, i.image_url, i.image_url_es,
      row_number() over (partition by membership.item_id order by i.rating desc nulls last, i.canonical_name asc, i.id asc) as position
    from membership join active_item i on i.id = membership.expansion_id
    where i.is_expansion = true and i.item_type = 'expansion' and i.has_approved_listing = true and i.id <= $2
  )
  select item_id, id, canonical_name, canonical_name_es, image_url, image_url_es
  from ranked where position <= $3 order by item_id, position
`;
