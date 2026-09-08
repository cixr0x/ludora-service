-- Read-only relational parity fixture: no application tables, writes or setup.
-- The route tests bind both joins below to the actual emitted route SQL.
with active_item(id, canonical_name, canonical_name_es, has_approved_listing) as (
  values
    (101::bigint, 'Zeta', 'Alpha', true),
    (102::bigint, 'Alpha', null, true),
    (103::bigint, 'Beta', null, true),
    (104::bigint, 'Blocked', null, false),
    (105::bigint, 'Gamma', null, true),
    (106::bigint, 'Unknown approval', null, null::boolean)
), item_relationships(item_a_id, item_b_id, link_type) as (
  values
    (2::bigint, 101::bigint, 'extension'),
    (2::bigint, 101::bigint, 'extension'),
    (101::bigint, 2::bigint, 'expansion'),
    (2::bigint, 102::bigint, 'extension'),
    (103::bigint, 2::bigint, 'expansion'),
    (2::bigint, 104::bigint, 'extension'),
    (2::bigint, 999::bigint, 'extension'),
    (2::bigint, 105::bigint, 'extension'),
    (2::bigint, 106::bigint, 'extension'),
    (101::bigint, 3::bigint, 'expansion'),
    (101::bigint, 4::bigint, 'extension'),
    (4::bigint, 102::bigint, 'expansion'),
    (4::bigint, 103::bigint, 'related'),
    (4::bigint, 105::bigint, null::text)
), prerender_page(id, parent_item_id, case_name, expected_ids) as (
  values
    (1::bigint, 101::bigint, 'legacy only', array[101]::bigint[]),
    (2::bigint, 101::bigint, 'deduplicated multiple parents and localized ordering', array[101,102,103,105]::bigint[]),
    (3::bigint, null::bigint, 'reverse expansion relationship', array[101]::bigint[]),
    (4::bigint, null::bigint, 'wrong directions and unrelated relationship types', array[]::bigint[]),
    (5::bigint, 104::bigint, 'unapproved legacy parent', array[]::bigint[]),
    (6::bigint, 999::bigint, 'missing legacy parent', array[]::bigint[]),
    (7::bigint, null::bigint, 'empty parents', array[]::bigint[]),
    (8::bigint, 106::bigint, 'null approval legacy parent', array[]::bigint[])
), original_results as (
  select i.id, parent_items.parent_items
  from prerender_page i
  -- BEGIN ORIGINAL JOIN
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
  -- END ORIGINAL JOIN
), export_results as (
  select i.id, parent_items.parent_items
  from prerender_page i
  -- BEGIN EXPORT JOIN
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
      from (
        select i.parent_item_id as parent_id where i.parent_item_id is not null
        union
        select relationship.item_b_id from item_relationships relationship
        where relationship.link_type = 'extension' and relationship.item_a_id = i.id
        union
        select relationship.item_a_id from item_relationships relationship
        where relationship.link_type = 'expansion' and relationship.item_b_id = i.id
      ) parent_ids
      join active_item parent on parent.id = parent_ids.parent_id and parent.has_approved_listing = true
    ) parent_item
  ) parent_items on true
  -- END EXPORT JOIN
), expected_results as (
  select i.id, coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', parent.id, 'canonical_name', parent.canonical_name,
      'canonical_name_es', parent.canonical_name_es
    ) order by expected.ordinality)
    from unnest(i.expected_ids) with ordinality expected(parent_id, ordinality)
    join active_item parent on parent.id = expected.parent_id
  ), '[]'::jsonb) as parent_items
  from prerender_page i
)
select i.id, i.case_name,
  original.parent_items as original_parents,
  exported.parent_items as export_parents,
  expected.parent_items as expected_parents,
  original.parent_items = exported.parent_items as parity,
  exported.parent_items = expected.parent_items as expected_match
from prerender_page i
join original_results original on original.id = i.id
join export_results exported on exported.id = i.id
join expected_results expected on expected.id = i.id
order by i.id;
