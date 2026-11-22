import { relatedBaseGameConditions } from './publicItem.js';

export type DiscoveryMode = 'similar' | 'mix';

type Source = { seed_id: number; traits: { id: number; kind: string; name: string }[] };
export type DiscoveryResponse = { seeds: unknown[]; results: { id: number; sources: Source[] }[] };

// Three candidates per seed suffice for assigning three distinct representatives.
// A source with at least three options can accommodate the other two choices.
export function distinctContributions(sources: Source[]): Source[] {
  let best: Source[] = [];
  let bestCost = Infinity;
  function choose(index: number, assigned: Source[], cost: number) {
    if (index === sources.length) {
      if (assigned.length > best.length || (assigned.length === best.length && cost < bestCost)) {
        best = assigned;
        bestCost = cost;
      }
      return;
    }
    const source = sources[index];
    source.traits.slice(0, 3).forEach((trait, priority) => {
      if (assigned.some(match => match.traits[0].id === trait.id)) return;
      choose(index + 1, [...assigned, { seed_id: source.seed_id, traits: [trait] }], cost + priority);
    });
    choose(index + 1, assigned, cost);
  }
  choose(0, [], 0);
  const used = new Set(best.map(source => source.traits[0].id));
  for (let extra = 0; extra < 2; extra++) {
    for (const source of best) {
      const available = sources.find(candidate => candidate.seed_id === source.seed_id)?.traits;
      const next = available?.find(trait => !used.has(trait.id));
      if (next) {
        source.traits.push(next);
        used.add(next.id);
      }
    }
  }
  return best;
}

export function discoverySeedIds(mode: unknown, value: unknown): number[] | undefined {
  if ((mode !== 'similar' && mode !== 'mix') || typeof value !== 'string' || value.length > 50) return;
  const parts = value.split(',');
  if (parts.length < (mode === 'mix' ? 2 : 1) || parts.length > (mode === 'mix' ? 3 : 1)) return;
  if (parts.some(part => !/^[1-9]\d*$/.test(part))) return;
  const ids = parts.map(Number);
  if (ids.some(id => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) return;
  return ids;
}

const taxonomies = [
  { kind: 'mechanic', link: 'item_mechanics', key: 'mechanic_id', labels: 'boardgame_mechanics' },
  { kind: 'category', link: 'item_categories', key: 'category_id', labels: 'boardgame_categories' },
  { kind: 'family', link: 'item_families', key: 'family_id', labels: 'boardgame_families' }
] as const;

// Join only the taxonomy IDs present in the seeds. The source and candidate
// share the same persisted taxonomy ID, including when a Spanish label is missing.
function sharedTraits(mode: DiscoveryMode): string {
  return taxonomies.filter(trait => mode === 'similar' || trait.kind === 'mechanic').map(trait => `
    select s.id as seed_id, candidate.item_id, '${trait.kind}' as kind, source.${trait.key} as trait_id,
      coalesce(nullif(btrim(label.name_es), ''), label.name) as name
    from seeds s
    join ${trait.link} source on source.item_id = s.id
    join ${trait.labels} label on label.id = source.${trait.key}
    join ${trait.link} candidate on candidate.${trait.key} = source.${trait.key}
    where candidate.item_id <> all($1::bigint[])
  `).join(' union all ');
}

export function discoverySql(mode: DiscoveryMode): string {
  const mix = mode === 'mix';
  // The single-seed tool uses the same count, rating and title order as Related.
  // For a mix, reward coverage of independent source mechanics and then balance
  // the weakest source. Common mechanics have less influence than rare ones.
  const ranking = mix
    ? 'r.covered desc, r.distinctive_sources desc, r.weakest_source desc, r.total_weight desc'
    : 'r.shared_count desc';
  // For 1–3 sets, a distinct representative per source is possible when
  // the union is large enough and singleton sources do not compete for
  // the same mechanic. These are all cases of Hall's condition up to 3.
  const coverage = mix ? `least(count(*), breadth.traits,
    count(*) - count(*) filter (where shared_count = 1) + count(distinct first_trait) filter (where shared_count = 1))` : 'count(*)';
  return `
    with seeds as (
      select i.id, i.canonical_name, i.canonical_name_es, i.image_url, i.image_url_es, s.position
      from unnest($1::bigint[]) with ordinality as s(id, position)
      join active_item i on i.id = s.id and i.has_approved_listing = true
    ),
    shared as (${sharedTraits(mode)}),
    trait_frequency as (
      select kind, trait_id, count(distinct seed_id) as seed_count, count(distinct item_id) as frequency
      from shared group by kind, trait_id
    ),
    weighted as (
      select t.*, f.seed_count, f.frequency,
        1.0 / (f.seed_count * ln(2.0 + f.frequency)) as weight
      from shared t join trait_frequency f using (kind, trait_id)
    ),
    source_scores as (
      select item_id, seed_id, count(*) as shared_count, sum(weight) as source_weight,
        bool_or(seed_count = 1) as distinctive, min(trait_id) as first_trait, max(trait_id) as last_trait
      from weighted group by item_id, seed_id
    ),
    ${mix ? 'breadth as (select item_id, count(distinct trait_id) as traits from weighted group by item_id),' : ''}
    scores as (
      select item_id, ${coverage} as covered, count(*) filter (where distinctive) as distinctive_sources,
        min(source_weight) as weakest_source, sum(source_weight) as total_weight, sum(shared_count) as shared_count
      from source_scores ${mix ? 'join breadth using (item_id)' : ''}
      group by item_id ${mix ? ', breadth.traits' : ''}
      ${mix ? 'having count(*) >= 2 and min(first_trait) <> max(last_trait)' : ''}
    ),
    ranked as (
      select i.id, i.canonical_name, i.canonical_name_es, i.image_url, i.image_url_es,
        row_number() over (order by ${ranking}, i.rating desc nulls last, i.canonical_name asc, i.id asc) as position
      from scores r join active_item i on i.id = r.item_id
      where ${relatedBaseGameConditions}
        and (select count(*) from seeds) = cardinality($1::bigint[])
      order by position limit $2
    ),
    reasons as (
      select t.*, row_number() over (
        partition by t.item_id, t.seed_id
        order by case t.kind when 'mechanic' then 1 when 'category' then 2 else 3 end,
          t.seed_count, t.frequency, t.name, t.trait_id
      ) as priority
      from weighted t join ranked r on r.id = t.item_id
    ),
    sources as (
      select item_id, seed_id,
        jsonb_agg(jsonb_build_object('id', trait_id, 'kind', kind, 'name', name) order by priority) as traits
      from reasons where priority <= ${mix ? 9 : 3} group by item_id, seed_id
    ),
    explanations as (
      select t.item_id,
        jsonb_agg(jsonb_build_object('seed_id', t.seed_id, 'traits', t.traits) order by s.position) as sources
      from sources t join seeds s on s.id = t.seed_id group by t.item_id
    )
    select
      (select coalesce(jsonb_agg(to_jsonb(s) - 'position' order by s.position), '[]') from seeds s) as seeds,
      (select coalesce(jsonb_agg((to_jsonb(r) - 'position') || jsonb_build_object('sources', e.sources) order by r.position), '[]')
        from ranked r join explanations e on e.item_id = r.id) as results
  `;
}
