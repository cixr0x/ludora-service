// Both catalog fields use the same 1–5 scale.
export const publicComplexitySql = `case when i.complexity between 1 and 5 then i.complexity
  when i.weight between 1 and 5 then i.weight end`;

export const relatedBaseGameConditions = `
    i.has_approved_listing = true
    and i.is_expansion = false
    and i.item_type = 'base_game'
    and i.parent_item_id is null`;
