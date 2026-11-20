import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { Database } from './db.js';

const emptyInterpretation = {
  players: null, playtimes: [], durationMin: null, durationMax: null,
  complexityMin: null, complexityMax: null, categoryIds: [], mechanicIds: [], theme: null
};

const taxonomy = {
  categories: [{ id: 5, name: 'Animals', name_es: 'Animales' }],
  mechanics: [{ id: 8, name: 'Tile Placement', name_es: 'Colocación de losetas' }]
};

const game = { id: '77', canonical_name: 'Sea Salt & Paper', categories: [], mechanics: [] };

function fixture(exactTitle?: string) {
  const query = vi.fn<Database['query']>(async (sql, params) => {
    if (sql.includes('category_options')) return { rows: [taxonomy] };
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
    expect(response.body.meta.filters).toMatchObject({ query: 'Sea %', mechanicIds: [8], complexityMax: 2.5 });
    expect(query.mock.lastCall?.[1]).toEqual(['%Sea%', '%\\%%', 2.5, [8], 40]);
    expect(interpret).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('finds a whole-input exact title in either language before invoking inference', async () => {
    const { app, query, interpret, embed } = fixture('Sal y papel');
    const response = await request(app).post(endpoint).send({ prompt: ' Sal y papel ' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ data: [game], meta: { filters: { exactTitle: 'Sal y papel', theme: null } } });
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

  it('requests a single strict Responses result from OpenAI and rejects a refusal', async () => {
    const { createOpenAILudoscopioInterpreter } = await import('./ludoscopio.js');
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
