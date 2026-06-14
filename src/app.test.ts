import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { Database } from './db.js';
import type { EmbeddingClient } from './embeddings.js';

describe('ludora service', () => {
  const normalizeSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim().toLowerCase();

  it('returns health status under the public api prefix', async () => {
    const response = await request(createApp({ database: idleDatabase() })).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'ludora-service'
    });
  });

  it('returns CORS headers for configured local UI origins', async () => {
    const app = createApp({
      database: idleDatabase(),
      corsOrigin: ['http://localhost:5174', 'http://127.0.0.1:5174']
    });

    const localhostResponse = await request(app).get('/api/health').set('Origin', 'http://localhost:5174');
    const loopbackResponse = await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5174');

    expect(localhostResponse.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    expect(loopbackResponse.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5174');
  });

  it('returns a stable 400 response for malformed JSON bodies', async () => {
    const response = await request(createApp({ database: idleDatabase() }))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        message: 'Invalid JSON body'
      }
    });
  });

  it('returns front page rows from configured categories and active items', async () => {
    const rows = [
      {
        category_id: 5,
        category_name: 'Party Game',
        category_name_es: 'Juego de fiesta',
        category_type: 'category',
        id: 1,
        order: 10,
        products: [
          {
            canonical_name: 'Coffee Rush',
            canonical_name_es: 'Cafeteria',
            id: 77,
            image_url: 'https://cdn.example/coffee.jpg',
            image_url_es: 'https://cdn.example/cafe.jpg',
            item_type: 'base_game',
            year_published: 2023
          }
        ],
        title: 'Noche de juegos'
      }
    ];
    const queries: string[] = [];
    const database: Database = {
      query: async (sql) => {
        queries.push(sql);
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get('/api/front-page');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: rows });
    const sql = normalizeSql(queries[0] ?? '');
    expect(sql).toContain('from front_page_categories fpc');
    expect(sql).toContain('left join front_page_category_items fpci');
    expect(sql).toContain('left join active_item i');
    expect(sql).toContain('jsonb_agg');
    expect(sql).toContain('order by fpc."order" asc, fpc.id asc');
    expect(sql).not.toContain('select *');
  });

  it('lists active items with taxonomy arrays and text search', async () => {
    const rows = [
      {
        canonical_name: 'Coffee Rush',
        categories: [{ id: 5, name: 'Party Game', name_es: 'Juego de fiesta' }],
        id: 77,
        mechanics: [{ id: 8, name: 'Action Drafting', name_es: 'Seleccion de acciones' }]
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get('/api/items?q=coffee&limit=12&offset=3');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      meta: {
        count: 1,
        limit: 12,
        offset: 3
      }
    });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('from active_item i');
    expect(sql).toContain('left join lateral');
    expect(sql).toContain('from item_categories ic');
    expect(sql).toContain('from item_mechanics im');
    expect(sql).toContain("where concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es) ilike $1 escape '\\'");
    expect(sql).toContain('order by i.canonical_name asc, i.id asc');
    expect(queries[0]?.params).toEqual(['%coffee%', 12, 3]);
  });

  it('lists active items by semantic query embedding', async () => {
    const rows = [
      {
        canonical_name: 'Calico',
        categories: [{ id: 5, name: 'Animals', name_es: 'Animales' }],
        id: 77,
        mechanics: [{ id: 8, name: 'Tile Placement', name_es: 'Colocacion de losetas' }],
        semantic_distance: '0.12'
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };
    const embeddingClient: EmbeddingClient = {
      embed: vi.fn(async () => [0.1, -0.2, 0.3])
    };

    const response = await request(
      createApp({
        database,
        embeddingClient,
        embeddingModel: 'text-embedding-3-small'
      })
    ).get('/api/items/semantic-search?q=games%20with%20cats&limit=7');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      meta: {
        count: 1,
        limit: 7
      }
    });
    expect(embeddingClient.embed).toHaveBeenCalledWith('games with cats');
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('from item_search_embeddings ise');
    expect(sql).toContain('join active_item i on i.id = ise.item_id');
    expect(sql).toContain('ise.embedding <=> $1::vector');
    expect(sql).toContain('where ise.model = $2');
    expect(sql).toContain('from item_categories ic');
    expect(sql).toContain('order by ise.embedding <=> $1::vector asc, i.canonical_name asc, i.id asc');
    expect(queries[0]?.params).toEqual(['[0.1,-0.2,0.3]', 'text-embedding-3-small', 7]);
  });

  it('rejects semantic search without a query before embedding or querying', async () => {
    const database: Database = {
      query: async () => {
        throw new Error('should not query');
      }
    };
    const embeddingClient: EmbeddingClient = {
      embed: vi.fn(async () => [0.1])
    };

    const response = await request(createApp({ database, embeddingClient })).get('/api/items/semantic-search?q=   ');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        message: 'q is required'
      }
    });
    expect(embeddingClient.embed).not.toHaveBeenCalled();
  });

  it('returns 503 for semantic search when embeddings are not configured', async () => {
    const response = await request(createApp({ database: idleDatabase() })).get(
      '/api/items/semantic-search?q=games%20with%20cats'
    );

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: {
        message: 'Semantic search is not configured'
      }
    });
  });

  it('returns one active item detail with public metadata', async () => {
    const row = {
      canonical_name: 'Coffee Rush',
      categories: [{ id: 5, name: 'Party Game', name_es: 'Juego de fiesta' }],
      designers: [{ id: 10, name: 'Euclides Lopes' }],
      id: 77,
      mechanics: [{ id: 8, name: 'Action Drafting', name_es: 'Seleccion de acciones' }],
      offers: [{ id: 300, store_name: 'Central de Juegos' }],
      publishers: [{ id: 11, name: 'Pythagoras' }],
      tutorials: [{ id: 9, source: 'youtube', title: 'Como jugar', url: 'https://youtube.example' }]
    };
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows: [row] };
      }
    };

    const response = await request(createApp({ database })).get('/api/items/77');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: row });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('from active_item i');
    expect(sql).toContain('from item_contributors ic');
    expect(sql).toContain("ic.contribution_role = 'designer'");
    expect(sql).toContain('from item_publishers ip');
    expect(sql).toContain('from tutorial_links tl');
    expect(sql).toContain('from store_items si');
    expect(sql).toContain('where i.id = $1');
    expect(queries[0]?.params).toEqual([77]);
  });

  it('returns 404 for missing active item detail', async () => {
    const response = await request(createApp({ database: idleDatabase() })).get('/api/items/77');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        message: 'Item not found'
      }
    });
  });

  it('rejects invalid item ids before querying the database', async () => {
    const database: Database = {
      query: async () => {
        throw new Error('should not query');
      }
    };

    const response = await request(createApp({ database })).get('/api/items/nope');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        message: 'id must be a positive integer'
      }
    });
  });

  it('returns public store offers for one item', async () => {
    const rows = [
      {
        availability: 'in_stock',
        currency: 'MXN',
        game_title: 'Coffee Rush',
        id: 300,
        price: '799.00',
        store_name: 'Central de Juegos'
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get('/api/items/77/stores');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: rows });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('from store_items si');
    expect(sql).toContain('join stores s on s.id = si.store_id');
    expect(sql).toContain('si.listing_status =');
    expect(sql).toContain('si.item_id = $1');
    expect(sql).toContain('order by si.price asc nulls last, s.name asc');
    expect(queries[0]?.params).toEqual([77]);
  });

  it('returns taxonomy for one item', async () => {
    const row = {
      categories: [{ id: 5, name: 'Party Game', name_es: 'Juego de fiesta' }],
      designers: [{ id: 10, name: 'Euclides Lopes' }],
      families: [],
      item_id: 77,
      mechanics: [{ id: 8, name: 'Action Drafting', name_es: 'Seleccion de acciones' }],
      publishers: [{ id: 11, name: 'Pythagoras' }]
    };
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows: [row] };
      }
    };

    const response = await request(createApp({ database })).get('/api/items/77/taxonomy');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: row });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('select $1::bigint as item_id');
    expect(sql).toContain('from item_categories ic');
    expect(sql).toContain('from item_mechanics im');
    expect(sql).toContain('from item_families ifa');
    expect(sql).toContain('from item_contributors ic');
    expect(sql).toContain('from item_publishers ip');
    expect(sql).toContain(') publishers on true');
    expect(queries[0]?.params).toEqual([77]);
  });

  it('returns JSON errors when database queries fail', async () => {
    const database: Database = {
      query: async () => {
        throw new Error('database unavailable');
      }
    };

    const response = await request(createApp({ database })).get('/api/front-page');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        message: 'database unavailable'
      }
    });
  });
});

function idleDatabase(): Database {
  return {
    query: async () => ({ rows: [] })
  };
}
