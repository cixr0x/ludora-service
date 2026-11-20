-- Read-only relational parity fixture: only CTE values and SELECTs.
-- The route test binds the optimized join to the actual item-detail query.
with stores(id, name, platform, canonical_domain, website_url, logo_url, country, updated_at,
  active, discovery_active, update_active) as (
  values
    (1::bigint, 'Alpha', 'shopify', 'alpha.test', 'https://alpha.test',
      'https://alpha.test/logo.png', 'MX', '2026-10-01T00:00:00Z'::timestamptz, true, false, false),
    (2::bigint, 'Beta', 'woocommerce', 'beta.test', 'https://beta.test',
      null::text, 'MX', '2026-10-02T00:00:00Z'::timestamptz, true, true, false),
    (3::bigint, 'Gamma', 'custom', 'gamma.test', 'https://gamma.test',
      null::text, 'MX', '2026-10-02T00:00:00Z'::timestamptz, false, true, true)
), offer_rows(id, item_id, store_id, price, availability,
  is_boardgame, is_boardgame_confirmed, listing_status, store_active) as (
  values
    (101::bigint, 1::bigint, 1::bigint, 20::numeric, 'available', true, true, 'LISTED', true),
    (201, 99, 1, 30, 'available', true, true, 'LISTED', true),
    (301, 3, 1, 40, 'available', true, true, 'LISTED', true),
    (401, 4, 1, 1, 'available', false, true, 'LISTED', true),
    (402, 99, 1, 1, 'available', true, false, 'LISTED', true),
    (403, 4, 1, 1, 'available', true, true, 'UNLISTED', true),
    (404, 99, 1, 1, 'available', true, true, 'LISTED', false),
    (405, 4, 1, 1, 'available', null::boolean, true, 'LISTED', true),
    (406, 99, 1, 1, 'available', true, null::boolean, 'LISTED', true),
    (407, 4, 1, 1, 'available', true, true, null::text, true),
    (408, 99, 1, 1, 'available', true, true, 'LISTED', null::boolean),
    (409, 4, 1, 10, 'available', true, true, 'LISTED', true),
    (501, 5, 1, 10, 'available', true, true, 'LISTED', true),
    (502, 99, 1, 1, 'available', true, true, 'LISTED', true),
    (701, 7, 999, 1, 'available', true, true, 'LISTED', true),
    (801, 8, 1, 10, 'available', true, true, 'LISTED', true),
    (802, 8, 1, 10, 'unknown', true, true, 'LISTED', true),
    (803, 8, 2, 10, 'available', true, true, 'LISTED', true),
    (804, 8, 1, null::numeric, null::text, true, true, 'LISTED', true),
    (805, 8, 1, 1, 'out_of_stock', true, true, 'LISTED', true),
    (806, 8, 1, 0, 'Sin Stock', true, true, 'LISTED', true),
    (807, 8, 1, 5, 'unavailable', true, true, 'LISTED', true),
    (808, 8, 1, 0, 'NO DISPONIBLE', true, true, 'LISTED', true),
    (809, 8, 3, 2, 'available', true, true, 'LISTED', true),
    (810, 99, 3, 1, 'available', true, true, 'LISTED', true),
    (901, 9, 1, 10, 'available', true, true, 'LISTED', true),
    (1001, 10, 1, 20, 'available', true, true, 'LISTED', true),
    (1002, 99, 1, 10, 'available', true, true, 'LISTED', true),
    (1101, 11, 3, 5, 'available', true, true, 'LISTED', true),
    (1201, 12, 1, 4, '  NO---DISPONIBLE  ', true, true, 'LISTED', true),
    (1202, 99, 1, 3, E'\tNO  DISPONIBLE\n', true, true, 'LISTED', true),
    (1203, 12, 1, 1, 'no_disponible', true, true, 'LISTED', true),
    (1204, 12, 1, 1, U&'NO\00A0DISPONIBLE', true, true, 'LISTED', true),
    (1205, 99, 1, 3, U&'\FEFFunavailable', true, true, 'LISTED', true),
    (1206, 12, 1, 2, U&'\2009NO\2028\2003-\3000DISPONIBLE\2029', true, true, 'LISTED', true)
), store_items as (
  select offer_rows.*,
    'https://store.test/products/' || id::text as source_url,
    'https://store.test/listings/' || id::text as source_listing_url,
    'Offer ' || id::text as title,
    'https://store.test/images/' || id::text || '.png' as image_url,
    price::text as raw_price,
    'MXN'::text as currency,
    '2026-10-03T00:00:00Z'::timestamptz as last_seen_at,
    '2026-10-04T00:00:00Z'::timestamptz as last_updated,
    '2026-10-05T00:00:00Z'::timestamptz as refreshed_date,
    null::text as language
  from offer_rows
), store_item_additional_items(store_item_id, item_id) as (
  values
    (201::bigint, 2::bigint),
    (201, 2),
    (301, 3),
    (301, 3),
    (402, 4),
    (404, 4),
    (406, 4),
    (408, 4),
    (501, 99),
    (9995, 5),
    (701, 7),
    (810, 8),
    (901, 99),
    (1002, 10),
    (1202, 12),
    (1205, 12)
), fixture_items(id, case_name, expected_ids, expected_bundles) as (
  values
    (1::bigint, 'primary offer', array[101]::bigint[], array[false]),
    (2, 'additional-only bundle with duplicate links', array[201]::bigint[], array[true]),
    (3, 'primary and additional overlap is returned once', array[301]::bigint[], array[true]),
    (4, 'false and null visibility predicates stay excluded', array[409]::bigint[], array[false]),
    (5, 'unrelated and missing listings stay excluded', array[501]::bigint[], array[true]),
    (6, 'no matching offers produces an empty array', array[]::bigint[], array[]::boolean[]),
    (7, 'a matching offer with a missing store stays excluded', array[]::bigint[], array[]::boolean[]),
    (8, 'hidden stores and unavailable listings are excluded from mixed lists',
      array[801,802,803,804,806,805]::bigint[],
      array[false,false,false,false,false,false]),
    (9, 'primary offer retains bundle flag for other contained games', array[901]::bigint[], array[true]),
    (10, 'multiple offers from one store stay distinct and sorted', array[1002,1001]::bigint[], array[true,false]),
    (11, 'all matching offers from hidden stores produce an empty array', array[]::bigint[], array[]::boolean[]),
    (12, 'only legacy unavailable direct and bundle offers leaves the product without offers',
      array[]::bigint[], array[]::boolean[])
), original_results as (
  select i.id, offers.offers
  from fixture_items i
  -- BEGIN ORIGINAL JOIN
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
          'last_seen_at', si.last_seen_at,
          'last_updated', si.last_updated,
          'refreshed_date', si.refreshed_date,
          'language', si.language,
          'store_updated_at', s.updated_at
        )
        order by
          case
            when lower(coalesce(si.availability, '')) in (
              'out_of_stock', 'outofstock', 'sold_out', 'soldout', 'sold-out',
              'agotado', 'sin_stock', 'sin stock'
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
      and si.store_active = true
      and translate(coalesce(si.availability, ''), U&'\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', repeat(' ', 24)) !~* '^ *(unavailable|no(_|[ -]+)disponible) *$'
      and s.active = true
  ) offers on true
  -- END ORIGINAL JOIN
), optimized_results as (
  select i.id, offers.offers
  from fixture_items i
  -- BEGIN OPTIMIZED JOIN
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
          'last_seen_at', si.last_seen_at,
          'last_updated', si.last_updated,
          'refreshed_date', si.refreshed_date,
          'language', si.language,
          'store_updated_at', s.updated_at
        )
        order by
          case
            when lower(coalesce(si.availability, '')) in (
              'out_of_stock', 'outofstock', 'sold_out', 'soldout', 'sold-out',
              'agotado', 'sin_stock', 'sin stock'
            ) then 1
            else 0
          end,
          si.price asc nulls last,
          s.name asc,
          si.id asc
      ),
      '[]'::jsonb
    ) as offers
    from (
      select direct_offer.id
      from store_items direct_offer
      where direct_offer.item_id = i.id

      union

      select additional.store_item_id
      from store_item_additional_items additional
      where additional.item_id = i.id
    ) matching_offers
    join store_items si on si.id = matching_offers.id
    join stores s on s.id = si.store_id
    where si.is_boardgame = true
      and si.is_boardgame_confirmed = true
      and si.listing_status = 'LISTED'
      and si.store_active = true
      and translate(coalesce(si.availability, ''), U&'\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', repeat(' ', 24)) !~* '^ *(unavailable|no(_|[ -]+)disponible) *$'
      and s.active = true
  ) offers on true
  -- END OPTIMIZED JOIN
), result_ids as (
  select i.id,
    coalesce((select array_agg((offer->>'id')::bigint order by ordinality)
      from jsonb_array_elements(original.offers) with ordinality as entries(offer, ordinality)),
      array[]::bigint[]) as original_ids,
    coalesce((select array_agg((offer->>'id')::bigint order by ordinality)
      from jsonb_array_elements(optimized.offers) with ordinality as entries(offer, ordinality)),
      array[]::bigint[]) as optimized_ids,
    coalesce((select array_agg((offer->>'is_bundle')::boolean order by ordinality)
      from jsonb_array_elements(optimized.offers) with ordinality as entries(offer, ordinality)),
      array[]::boolean[]) as optimized_bundles
  from fixture_items i
  join original_results original on original.id = i.id
  join optimized_results optimized on optimized.id = i.id
)
select i.id, i.case_name, result_ids.original_ids, result_ids.optimized_ids,
  i.expected_ids, result_ids.optimized_bundles, i.expected_bundles,
  original.offers = optimized.offers as parity,
  result_ids.optimized_ids = i.expected_ids
    and result_ids.optimized_bundles = i.expected_bundles as expected_match
from fixture_items i
join original_results original on original.id = i.id
join optimized_results optimized on optimized.id = i.id
join result_ids on result_ids.id = i.id
order by i.id;
