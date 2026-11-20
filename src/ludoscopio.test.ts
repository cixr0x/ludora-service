import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { Database } from './db.js';
import { createOpenAILudoscopioInterpreter } from './ludoscopio.js';

const emptyInterpretation = {
  players: null, playtimes: [], durationMin: null, durationMax: null,
  complexityMin: null, complexityMax: null, categoryIds: [], mechanicIds: [],
  suggestedCategoryIds: [], suggestedMechanicIds: [], theme: null
};

const taxonomy = {
  categories: [{ id: 5, name: 'Animals', name_es: 'Animales' }],
  mechanics: [{ id: 8, name: 'Tile Placement', name_es: 'Colocación de losetas' }]
};

const game = { id: '77', canonical_name: 'Sea Salt & Paper', categories: [], mechanics: [] };

const comparisonTaxonomy = {
  categories: [
    { id: 21, name: 'Medieval', name_es: 'Medieval' },
    { id: 35, name: 'City Building', name_es: 'Construcción de ciudades' },
    { id: 41, name: 'Economic', name_es: 'Económico' },
    { id: 70, name: 'Civilization', name_es: 'Civilización' }
  ],
  mechanics: [
    { id: 8, name: 'Tile Placement', name_es: 'Colocación de losetas' },
    { id: 53, name: 'Resource Management', name_es: 'Gestión de recursos' }
  ]
};

function fixture(exactTitle?: string, publicTaxonomy = taxonomy) {
  const query = vi.fn<Database['query']>(async (sql, params) => {
    if (sql.includes('category_options')) return { rows: [publicTaxonomy] };
    if (sql.includes('lower(btrim(i.canonical_name')) {
      return { rows: params?.[0] === exactTitle ? [game] : [] };
    }
    return { rows: [game] };
  });
  const embed = vi.fn(async (_text: string) => [0.1, 0.2]);
  const interpret = vi.fn(async (_prompt: string, _taxonomy: unknown): Promise<unknown> => emptyInterpretation);
  const app = createApp({ database: { query }, embeddingClient: { embed }, ludoscopioInterpreter: { interpret } });
  return { app, embed, interpret, query };
}

const endpoint = '/api/items/ludoscopio';
const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

describe('Ludoscopio hybrid search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('embeds only the interpreted theme and filters the catalog before limiting', async () => {
    const { app, query, interpret, embed } = fixture();
    const prompt = 'Somos cuatro y buscamos algo rápido y fácil sobre piratas';
    const filters = {
      ...emptyInterpretation, players: 4, playtimes: ['short'], complexityMin: 1, complexityMax: 2,
      categoryIds: [5], mechanicIds: [8], theme: 'piratas'
    };
    interpret.mockResolvedValueOnce(filters);

    const response = await request(app).post(endpoint).send({ prompt, limit: 7 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [game], meta: { count: 1, limit: 7, filters: { ...filters, exactTitle: null, query: null } }
    });
    expect(interpret).toHaveBeenCalledExactlyOnceWith(prompt, taxonomy);
    expect(embed).toHaveBeenCalledExactlyOnceWith('piratas');
    const [rawSql, params] = query.mock.lastCall!;
    const sql = normalizeSql(rawSql);
    expect(sql).toMatch(/active_item i .*where i\.has_approved_listing = true .*coalesce\(i\.min_players, i\.max_players\) <= \$1 .*coalesce\(i\.max_players, i\.min_players\) >= \$1/);
    expect(sql).toMatch(/case when i\.complexity between 1 and 5 then i\.complexity when i\.weight between 1 and 5 then i\.weight end >= \$2/);
    expect(sql).toMatch(/case when i\.complexity between 1 and 5 then i\.complexity when i\.weight between 1 and 5 then i\.weight end <= \$3/);
    expect(sql).toMatch(/category_id = any\(\$4::bigint\[\]\).*cardinality\(\$4::bigint\[\]\)/);
    expect(sql).toMatch(/mechanic_id = any\(\$5::bigint\[\]\).*cardinality\(\$5::bigint\[\]\)/);
    expect(sql).toMatch(/coalesce\(i\.min_minutes, i\.max_minutes\) <= \$6\).*<= \$9 order by semantic_distance asc, i\.canonical_name asc, i\.id asc limit \$10/);
    expect(sql).toContain('coalesce(i.min_minutes, i.max_minutes) > 0');
    expect(sql).toContain('coalesce(i.max_minutes, i.min_minutes) >= coalesce(i.min_minutes, i.max_minutes)');
    expect(params).toEqual([4, 1, 2, [5], [8], 44, '[0.1,0.2]', 'text-embedding-3-small', 0.62, 7]);
  });

  it('requires known explicit duration bounds and avoids embeddings for filter-only prompts', async () => {
    const { app, query, interpret, embed } = fixture();
    interpret.mockResolvedValueOnce({ ...emptyInterpretation, durationMin: 10, durationMax: 25, playtimes: ['short'] });

    const response = await request(app).post(endpoint).send({ prompt: 'Entre 10 y 25 minutos' });

    expect(response.status).toBe(200);
    expect(response.body.meta.filters).toMatchObject({ durationMin: 10, durationMax: 25, playtimes: [], theme: null });
    const [rawSql, params] = query.mock.lastCall!;
    const sql = normalizeSql(rawSql);
    expect(sql).toMatch(/where i\.has_approved_listing = true and i\.min_minutes >= \$1 and i\.max_minutes > 0 and i\.max_minutes <= \$2 order by i\.canonical_name asc, i\.id asc limit \$3/);
    expect(params).toEqual([10, 25, 40]);
    expect(sql).not.toContain('item_search_embeddings');
    expect(embed).not.toHaveBeenCalled();
  });

  it('refines with the current filters and no second interpretation', async () => {
    const { app, query, interpret, embed } = fixture();
    const response = await request(app).post(endpoint).send({ filters: { query: 'Sea %', mechanicIds: [8, 8], complexityMax: 2.5 } });

    expect(response.status).toBe(200);
    expect(response.body.meta.filters).toMatchObject({
      query: 'Sea %', mechanicIds: [8], complexityMax: 2.5, suggestedCategoryIds: [], suggestedMechanicIds: []
    });
    expect(query.mock.lastCall?.[1]).toEqual(['%Sea%', '%\\%%', 2.5, [8], 40]);
    expect(interpret).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('uses inferred themes for retrieval and applies taxonomy suggestions only to ranking', async () => {
    const { app, query, interpret, embed } = fixture(undefined, comparisonTaxonomy);
    const theme = 'Age of Empires: construcción de ciudades, economía y estrategia medieval';
    interpret.mockResolvedValueOnce({
      ...emptyInterpretation, players: 4, mechanicIds: [8], theme,
      suggestedCategoryIds: [53, 21, 999, 21, 35],
      suggestedMechanicIds: [35, 53]
    });

    const response = await request(app).post(endpoint)
      .send({ prompt: 'Como Age of Empires pero sin combate, para cuatro y con colocación de losetas', limit: 7 });

    expect(response.status).toBe(200);
    expect(response.body.meta.filters).toMatchObject({
      suggestedCategoryIds: [21, 35], suggestedMechanicIds: [53], categoryIds: [], mechanicIds: [8], theme
    });
    expect(embed).toHaveBeenCalledExactlyOnceWith(theme);
    const [rawSql, params] = query.mock.lastCall!;
    expect(params).toEqual([4, [8], '[0.1,0.2]', 'text-embedding-3-small', 0.62, [21, 35], [53], 7]);
    const sql = normalizeSql(rawSql);
    expect(sql).toMatch(/\(ise\.embedding <=> \$3::vector\) as semantic_distance/);
    expect(sql).toMatch(/\(ise\.embedding <=> \$3::vector\) - .*least\(3, .*category_id = any\(\$6::bigint\[\]\).*mechanic_id = any\(\$7::bigint\[\]\).*0\.025/);
    const eligibility = sql.slice(sql.indexOf('from active_item i'), sql.indexOf('order by'));
    expect(eligibility).toContain('= cardinality($2::bigint[])');
    expect(eligibility).toContain('(ise.embedding <=> $3::vector) <= $5');
    expect(eligibility).not.toContain('$6');
    expect(eligibility).not.toContain('$7');
    expect(sql).toMatch(/order by .*rank asc, .*semantic_distance asc, i\.canonical_name asc, i\.id asc limit \$8/);
    expect(sql).toMatch(/order by .*rank asc, .*semantic_distance asc, i\.canonical_name asc, i\.id asc$/);
  });

  it('keeps valid soft IDs bounded during refinement without retrieving an embedding for a removed theme', async () => {
    const { app, query, interpret, embed } = fixture(undefined, comparisonTaxonomy);
    const response = await request(app).post(endpoint).send({ filters: {
      categoryIds: [21],
      suggestedCategoryIds: [0, 21, 35, 41, 41, 999],
      suggestedMechanicIds: [8, 53, '53', 7.5]
    } });

    expect(response.status).toBe(200);
    expect(response.body.meta.filters).toMatchObject({
      categoryIds: [21], suggestedCategoryIds: [21, 35, 41], suggestedMechanicIds: [8], theme: null
    });
    const [rawSql, params] = query.mock.lastCall!;
    expect(params).toEqual([[21], [21, 35, 41], [8], 40]);
    const sql = normalizeSql(rawSql);
    expect(sql).toMatch(/= cardinality\(\$1::bigint\[\]\) order by .*rank desc, i\.canonical_name asc, i\.id asc limit \$4/);
    expect(sql).toMatch(/order by .*rank desc, i\.canonical_name asc, i\.id asc$/);
    expect(sql).not.toContain('item_search_embeddings');
    expect(interpret).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('finds a whole-input exact title in either language before invoking inference', async () => {
    const { app, query, interpret, embed } = fixture('Sal y papel');
    const response = await request(app).post(endpoint).send({ prompt: ' Sal y papel ' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [game], meta: { filters: {
        exactTitle: 'Sal y papel', theme: null, suggestedCategoryIds: [], suggestedMechanicIds: []
      } }
    });
    expect(query.mock.lastCall?.[0]).toMatch(/lower\(btrim\(i\.canonical_name\)\).*lower\(btrim\(i\.canonical_name_es\)\)/s);
    expect(interpret).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it.each([
    { prompt: ' ' }, { prompt: 'x'.repeat(501) }, { prompt: 'uno', filters: {} },
    { filters: { players: 1.5 } }, { filters: { durationMin: 90, durationMax: 45 } },
    { filters: { complexityMin: 0 } }, { filters: { categoryIds: [999] } },
    { filters: { mechanicIds: [5] } }, { filters: { playtimes: ['all day'] } }
  ])('rejects invalid client input %j before an interpretation', async (body) => {
    const { app, interpret, embed } = fixture();
    const response = await request(app).post(endpoint).send(body);
    expect(response.status).toBe(400);
    expect(interpret).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('masks rejected embeddings and invalid interpretation output', async () => {
    const { app, interpret, embed } = fixture();
    interpret
      .mockRejectedValueOnce(new Error('provider confidential details'))
      .mockResolvedValueOnce({ ...emptyInterpretation, categoryIds: [999] });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(app).post(endpoint).send({ prompt: 'consulta' });
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: { message: 'Ludoscopio search is temporarily unavailable' } });
    }

    embed.mockRejectedValueOnce(new Error('provider confidential details'));
    const response = await request(app).post(endpoint).send({ filters: { theme: 'piratas' } });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { message: 'Ludoscopio search is temporarily unavailable' } });
  });

  it('requests inferred suggestions and an expanded theme in the same strict interpretation', async () => {
    const prompt = 'Quiero un juego como Age of Empires pero sin combate';
    const structured = {
      ...emptyInterpretation,
      theme: 'Age of Empires, construcción de ciudades, economía y ambientación medieval',
      suggestedCategoryIds: [21, 35]
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      status: 'completed',
      output: [{
        type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(structured) }]
      }]
    }));
    vi.stubGlobal('fetch', fetch);
    const interpreter = createOpenAILudoscopioInterpreter('test-key');

    await expect(interpreter.interpret(prompt, comparisonTaxonomy)).resolves.toEqual(structured);
    expect(fetch).toHaveBeenCalledTimes(1);
    const input = JSON.parse(String(fetch.mock.lastCall?.[1]?.body));
    expect(input.text.format.schema.required).toEqual(expect.arrayContaining(['suggestedCategoryIds', 'suggestedMechanicIds']));
    expect(input.text.format.schema.properties).toMatchObject({
      suggestedCategoryIds: { type: 'array', items: { type: 'integer' } },
      suggestedMechanicIds: { type: 'array', items: { type: 'integer' } }
    });
    expect(input.input[0].content).toContain('Age of Empires');
    expect(input.input[0].content).toContain('sin combate');
    expect(input.input[0].content).toContain('City Building');
    expect(input.input[1]).toEqual({ role: 'user', content: prompt });
  });

  it('requests a single strict Responses result from OpenAI and rejects a refusal', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      status: 'completed',
      output: [{
        type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'refusal', refusal: 'provider detail' }]
      }]
    }));
    vi.stubGlobal('fetch', fetch);
    const interpreter = createOpenAILudoscopioInterpreter('test-key');
    const taxonomyWithBggIds = {
      categories: [{ ...taxonomy.categories[0]!, bgg_id: 1089 }],
      mechanics: [{ ...taxonomy.mechanics[0]!, bgg_id: 2002 }]
    };

    await expect(interpreter.interpret('sin colocación de losetas', taxonomyWithBggIds)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.lastCall!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: 'gpt-6-luna', store: false, reasoning: { effort: 'none' },
      text: { format: { type: 'json_schema', strict: true, schema: { additionalProperties: false } } },
      input: expect.arrayContaining([
        { role: 'user', content: 'sin colocación de losetas' }
      ])
    });
    expect(String(options?.body)).toContain('Colocación de losetas');
    expect(String(options?.body)).not.toContain('bgg_id');
  });

  it('shares the strict rate limit applied to semantic requests', async () => {
    const app = createApp({ database: { query: async () => ({ rows: [] }) },
      publicApiStrictRateLimit: { max: 1, windowMs: 60_000 } });
    expect((await request(app).post(endpoint).send({ filters: {} })).status).toBe(200);
    expect((await request(app).post(endpoint).send({ filters: {} })).status).toBe(429);
  });
});
