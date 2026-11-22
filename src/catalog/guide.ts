import { publicComplexitySql, relatedBaseGameConditions } from './publicItem.js';

const levels = new Map<string, [number, number] | null>([
  ['any', null], ['light', [0, 2]], ['medium', [2, 3.5]], ['heavy', [3.5, 5]]
]);
const styles = new Map<string, string | null>([
  ['any', null], ['cooperative', 'Cooperative Game'], ['teams', 'Team-Based Game'], ['negotiation', 'Negotiation']
]);

export function guideParameters(query: Record<string, unknown>): unknown[] | undefined {
  const { players, minutes = 'any', complexity = 'any', style = 'any' } = query;
  if (typeof players !== 'string' || !/^[1-9]\d?$/.test(players)) return;
  if (typeof minutes !== 'string' || !['any', '15', '30', '45', '60', '90', '120', '180'].includes(minutes)) return;
  if (typeof complexity !== 'string' || !levels.has(complexity) || typeof style !== 'string' || !styles.has(style)) return;
  const range = levels.get(complexity);
  return [Number(players), minutes === 'any' ? null : Number(minutes), range?.[0] ?? null, range?.[1] ?? null, styles.get(style)];
}

export const guideSql = `
  select i.id, i.canonical_name, i.canonical_name_es, i.image_url, i.image_url_es,
    i.min_players, i.max_players, i.min_minutes, i.max_minutes, ${publicComplexitySql} as complexity
  from active_item i
  where ${relatedBaseGameConditions}
    and i.min_players between 1 and $1 and i.max_players >= $1
    and ($2::integer is null or (i.max_minutes > 0 and i.max_minutes <= $2))
    and ($3::numeric is null or ((${publicComplexitySql}) > $3 and (${publicComplexitySql}) <= $4::numeric))
    and ($5::text is null or exists (
      select 1 from item_mechanics im join boardgame_mechanics bm on bm.id = im.mechanic_id
      where im.item_id = i.id and bm.name = $5
    ))
  order by i.rating desc nulls last, i.canonical_name, i.id
  limit 3
`;
