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

  it('stores a contact form submission with trimmed public fields', async () => {
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows: [{ id: 42 }] };
      }
    };

    const response = await request(createApp({ database })).post('/api/contact').send({
      name: '  Maria Garcia  ',
      email: '  maria@example.com  ',
      message: '  Quiero sugerir una tienda.  '
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { id: 42 } });
    expect(queries).toHaveLength(1);
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('insert into contact_form_submissions');
    expect(sql).toContain('(name, email, message)');
    expect(sql).toContain('values ($1, $2, $3)');
    expect(sql).toContain('returning id');
    expect(queries[0]?.params).toEqual(['Maria Garcia', 'maria@example.com', 'Quiero sugerir una tienda.']);
  });

  it('rejects invalid contact form submissions before querying', async () => {
    const database: Database = {
      query: async () => {
        throw new Error('should not query');
      }
    };

    const response = await request(createApp({ database })).post('/api/contact').send({
      name: '',
      email: 'not-an-email',
      message: ''
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        message: 'name, a valid email, and message are required'
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
            image_url_es: 'https://cdn.example/cafe.jpg'
          }
        ],
        title: 'Noche de juegos',
        title_display: 'Para empezar la noche'
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
    expect(sql).toContain('fpc.title_display');
    expect(sql).toContain('left join front_page_category_items fpci');
    expect(sql).toContain('left join active_item i');
    expect(sql).toContain('jsonb_agg');
    expect(sql).toContain("'id', i.id");
    expect(sql).toContain("'canonical_name', i.canonical_name");
    expect(sql).toContain("'canonical_name_es', i.canonical_name_es");
    expect(sql).toContain("'image_url', i.image_url");
    expect(sql).toContain("'image_url_es', i.image_url_es");
    expect(sql).not.toContain("'item_type', i.item_type");
    expect(sql).not.toContain("'year_published', i.year_published");
    expect(sql).not.toContain("'rating', i.rating");
    expect(sql).not.toContain("'min_players', i.min_players");
    expect(sql).not.toContain("'max_players', i.max_players");
    expect(sql).not.toContain("'min_minutes', i.min_minutes");
    expect(sql).not.toContain("'max_minutes', i.max_minutes");
    expect(sql).not.toContain("'complexity', i.complexity");
    expect(sql).not.toContain("'has_approved_listing', i.has_approved_listing");
    expect(sql).not.toContain("'is_expansion', i.is_expansion");
    expect(sql).toContain('order by i.rating desc nulls last, fpci.item_order asc, i.canonical_name asc, i.id asc');
    expect(sql).toContain('order by fpc."order" asc, fpc.id asc');
    expect(sql).not.toContain('select *');
  });

  it('lists active items with taxonomy arrays and text search', async () => {
    const rows = [
      {
        canonical_name: 'Coffee Rush',
        categories: [{ id: 5, name: 'Party Game', name_es: 'Juego de fiesta' }],
        id: 77,
        mechanics: [{ id: 8, name: 'Action Drafting', name_es: 'Seleccion de acciones' }],
        rating: '7.37125'
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
    expect(sql).toContain('i.rating');
    expect(sql).toContain('i.has_approved_listing');
    expect(sql).toContain('i.is_expansion');
    expect(sql).toContain('i.has_approved_listing = true');
    expect(sql).toContain('left join lateral');
    expect(sql).toContain('from item_categories ic');
    expect(sql).toContain('from item_mechanics im');
    expect(sql).toContain("concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es) ilike $1 escape '\\'");
    expect(sql).toContain('order by i.canonical_name asc, i.id asc');
    expect(queries[0]?.params).toEqual(['%coffee%', 12, 3]);
  });

  it('lists lightweight item summaries without detail-only fields', async () => {
    const rows = [
      {
        canonical_name: 'Coffee Rush',
        canonical_name_es: 'Cafeteria',
        categories: [{ id: 5, name: 'Party Game', name_es: 'Juego de fiesta' }],
        id: 77,
        image_url: 'https://cdn.example/coffee.jpg',
        image_url_es: 'https://cdn.example/cafe.jpg',
        is_expansion: false,
        item_type: 'base_game',
        max_minutes: 30,
        max_players: 4,
        mechanics: [{ id: 8, name: 'Action Drafting', name_es: 'Seleccion de acciones' }],
        min_minutes: 20,
        min_players: 2,
        rating: '7.37125'
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get('/api/items/summary?q=coffee&limit=12&offset=3');

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
    expect(sql).toContain('i.canonical_name');
    expect(sql).toContain('i.image_url');
    expect(sql).toContain('i.min_players');
    expect(sql).toContain('i.max_minutes');
    expect(sql).toContain('coalesce(categories.categories');
    expect(sql).toContain('coalesce(mechanics.mechanics');
    expect(sql).toContain("concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es) ilike $1 escape '\\'");
    expect(sql).toContain('order by i.canonical_name asc, i.id asc');
    expect(sql).not.toContain('i.description');
    expect(sql).not.toContain('i.description_es');
    expect(sql).not.toContain('from item_contributors');
    expect(sql).not.toContain('from item_publishers');
    expect(sql).not.toContain('from store_items');
    expect(queries[0]?.params).toEqual(['%coffee%', 12, 3]);
  });

  it('lists minimal search result items without summary-only fields', async () => {
    const rows = [
      {
        canonical_name: 'Coffee Rush',
        canonical_name_es: 'Cafeteria',
        id: 77,
        image_url: 'https://cdn.example/coffee.jpg',
        image_url_es: 'https://cdn.example/cafe.jpg',
        is_expansion: false,
        item_type: 'base_game',
        parent_item_id: null
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get(
      '/api/items/search-results?q=coffee&players=4&duration_min=30&duration_max=75&complexity_min=2&complexity_max=4&category_ids=5,7&mechanic_ids=8,9&limit=24&offset=6'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      meta: {
        count: 1,
        limit: 24,
        offset: 6
      }
    });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    const selectSql = sql.match(/^select (.*) from active_item i/)?.[1] ?? '';
    expect(sql).toContain('from active_item i');
    expect(selectSql).toContain('i.canonical_name');
    expect(selectSql).toContain('i.canonical_name_es');
    expect(selectSql).toContain('i.image_url');
    expect(selectSql).toContain('i.image_url_es');
    expect(selectSql).toContain('i.item_type');
    expect(selectSql).toContain('i.parent_item_id');
    expect(selectSql).toContain('i.is_expansion');
    expect(sql).toContain('i.has_approved_listing = true');
    expect(sql).toContain("concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es) ilike $1 escape '\\'");
    expect(sql).toContain('coalesce(i.min_players, i.max_players) <= $2');
    expect(sql).toContain('coalesce(i.max_players, i.min_players) >= $2');
    expect(sql).toContain('coalesce(i.max_minutes, i.min_minutes) >= $3');
    expect(sql).toContain('coalesce(i.min_minutes, i.max_minutes) <= $4');
    expect(sql).toContain('i.complexity >= $5');
    expect(sql).toContain('i.complexity <= $6');
    expect(sql).toContain('ic.category_id = any($7::bigint[])');
    expect(sql).toContain('= cardinality($7::bigint[])');
    expect(sql).toContain('im.mechanic_id = any($8::bigint[])');
    expect(sql).toContain('= cardinality($8::bigint[])');
    expect(sql).toContain('order by i.canonical_name asc, i.id asc');
    expect(sql).toContain('limit $9');
    expect(sql).toContain('offset $10');
    expect(selectSql).not.toContain('coalesce(categories.categories');
    expect(selectSql).not.toContain('coalesce(mechanics.mechanics');
    expect(sql).not.toContain('left join lateral');
    expect(selectSql).not.toContain('i.min_players,');
    expect(selectSql).not.toContain('i.max_players,');
    expect(selectSql).not.toContain('i.min_minutes,');
    expect(selectSql).not.toContain('i.max_minutes,');
    expect(selectSql).not.toContain('i.complexity,');
    expect(selectSql).not.toContain('i.rating,');
    expect(queries[0]?.params).toEqual(['%coffee%', 4, 30, 75, 2, 4, [5, 7], [8, 9], 24, 6]);
  });

  it('returns lightweight catalog filter options', async () => {
    const row = {
      categories: [{ id: 5, name: 'Party Game', name_es: 'Juego de fiesta' }],
      mechanics: [{ id: 8, name: 'Action Drafting', name_es: 'Seleccion de acciones' }]
    };
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows: [row] };
      }
    };

    const response = await request(createApp({ database })).get('/api/items/filter-options');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: row });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('jsonb_agg');
    expect(sql).toContain('from item_categories ic');
    expect(sql).toContain('from item_mechanics im');
    expect(sql).toContain('join active_item i on i.id = ic.item_id');
    expect(sql).toContain('join active_item i on i.id = im.item_id');
    expect(sql).toContain('i.has_approved_listing = true');
    expect(sql).not.toContain('i.description');
    expect(sql).not.toContain('from store_items');
    expect(queries[0]?.params).toBeUndefined();
  });

  it('splits text search into independent partial title tokens', async () => {
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows: [] };
      }
    };

    const response = await request(createApp({ database })).get('/api/items?q=sea%20ext&limit=12');

    expect(response.status).toBe(200);
    const sql = normalizeSql(queries[0]?.sql ?? '');
    const searchableTitleSql =
      "concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es)";
    expect(sql).toContain(`${searchableTitleSql} ilike $1 escape '\\'`);
    expect(sql).toContain(`${searchableTitleSql} ilike $2 escape '\\'`);
    expect(queries[0]?.params).toEqual(['%sea%', '%ext%', 12, 0]);
  });

  it('lists only approved listed items using public search filters', async () => {
    const rows = [
      {
        canonical_name: 'Coffee Rush: Extra Shot',
        categories: [{ id: 5, name: 'Party Game', name_es: 'Juego de fiesta' }],
        id: 77,
        is_expansion: true,
        mechanics: [{ id: 8, name: 'Action Drafting', name_es: 'Seleccion de acciones' }],
        rating: '7.37125'
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get(
      '/api/items?q=coffee&players=4&duration_min=30&duration_max=75&complexity_min=2&complexity_max=4&category_ids=5,7&mechanic_ids=8,9&limit=24&offset=6'
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      meta: {
        count: 1,
        limit: 24,
        offset: 6
      }
    });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('from active_item i');
    expect(sql).toContain('i.has_approved_listing = true');
    expect(sql).not.toContain('i.is_expansion = false');
    expect(sql).toContain("concat_ws(' ', i.canonical_name, i.canonical_name_es, i.normalized_name, i.normalized_name_es) ilike $1 escape '\\'");
    expect(sql).toContain('coalesce(i.min_players, i.max_players) <= $2');
    expect(sql).toContain('coalesce(i.max_players, i.min_players) >= $2');
    expect(sql).toContain('coalesce(i.min_minutes, i.max_minutes) <= $4');
    expect(sql).toContain('coalesce(i.max_minutes, i.min_minutes) >= $3');
    expect(sql).toContain('i.complexity >= $5');
    expect(sql).toContain('i.complexity <= $6');
    expect(sql).toContain('ic.category_id = any($7::bigint[])');
    expect(sql).toContain('= cardinality($7::bigint[])');
    expect(sql).toContain('im.mechanic_id = any($8::bigint[])');
    expect(sql).toContain('= cardinality($8::bigint[])');
    expect(sql).toContain('limit $9');
    expect(sql).toContain('offset $10');
    expect(queries[0]?.params).toEqual(['%coffee%', 4, 30, 75, 2, 4, [5, 7], [8, 9], 24, 6]);
  });

  it('rejects malformed taxonomy filter ids before querying', async () => {
    const database: Database = {
      query: async () => {
        throw new Error('should not query');
      }
    };

    const response = await request(createApp({ database })).get('/api/items?category_ids=5,nope');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        message: 'category_ids must contain positive integers'
      }
    });
  });

  it('lists active items by semantic query embedding', async () => {
    const rows = [
      {
        canonical_name: 'Calico',
        categories: [{ id: 5, name: 'Animals', name_es: 'Animales' }],
        id: 77,
        mechanics: [{ id: 8, name: 'Tile Placement', name_es: 'Colocacion de losetas' }],
        rating: '7.2',
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
    expect(sql).toContain('i.rating');
    expect(sql).toContain('ise.embedding <=> $1::vector');
    expect(sql).toContain('where ise.model = $2');
    expect(sql).toContain('i.has_approved_listing = true');
    expect(sql).toContain('(ise.embedding <=> $1::vector) <= $3');
    expect(sql).toContain('from item_categories ic');
    expect(sql).toContain('order by ise.embedding <=> $1::vector asc, i.canonical_name asc, i.id asc');
    expect(queries[0]?.params).toEqual(['[0.1,-0.2,0.3]', 'text-embedding-3-small', 0.62, 7]);
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

  it('lists minimal related items from shared taxonomy', async () => {
    const rows = [
      {
        canonical_name: 'Coffee Rush',
        canonical_name_es: 'Cafeteria',
        id: 77,
        image_url: 'https://cdn.example/coffee.jpg',
        image_url_es: 'https://cdn.example/cafe.jpg'
      }
    ];
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows };
      }
    };

    const response = await request(createApp({ database })).get('/api/items/99/related?limit=12');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: rows,
      meta: {
        count: 1,
        limit: 12
      }
    });
    const sql = normalizeSql(queries[0]?.sql ?? '');
    const selectSql = sql.match(/select (.*) from related_scores rs/)?.[1] ?? '';
    expect(sql).toContain('with target_taxonomy as');
    expect(sql).toContain('from item_categories ic');
    expect(sql).toContain('from item_mechanics im');
    expect(sql).toContain('from item_families ifa');
    expect(sql).toContain('join target_taxonomy tt');
    expect(sql).toContain('ct.item_id <> $1');
    expect(sql).toContain('join active_item i on i.id = rs.item_id');
    expect(sql).toContain('i.has_approved_listing = true');
    expect(sql).toContain('order by rs.shared_taxonomy_count desc, i.rating desc nulls last, i.canonical_name asc, i.id asc');
    expect(sql).toContain('limit $2');
    expect(selectSql).toContain('i.id');
    expect(selectSql).toContain('i.canonical_name');
    expect(selectSql).toContain('i.canonical_name_es');
    expect(selectSql).toContain('i.image_url');
    expect(selectSql).toContain('i.image_url_es');
    expect(selectSql).not.toContain('i.rating');
    expect(selectSql).not.toContain('i.min_players');
    expect(selectSql).not.toContain('i.max_players');
    expect(selectSql).not.toContain('i.complexity');
    expect(sql).not.toContain('left join lateral');
    expect(queries[0]?.params).toEqual([99, 12]);
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
      rating: '7.37125',
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
    expect(sql).toContain('i.rating');
    expect(sql).toContain('from item_contributors ic');
    expect(sql).toContain("ic.contribution_role = 'designer'");
    expect(sql).toContain('from item_publishers ip');
    expect(sql).toContain('from tutorial_links tl');
    expect(sql).toContain('from store_items si');
    expect(sql).toContain('where i.id = $1');
    expect(queries[0]?.params).toEqual([77]);
  });

  it('falls back to published parent tutorials for expansions without direct tutorials', async () => {
    const row = {
      canonical_name: 'Coffee Rush Expansion',
      id: 88,
      is_expansion: true,
      parent_item_id: 77,
      tutorials: [{ id: 9, source: 'tiktok', title: 'Como jugar', url: 'https://www.tiktok.com/@creator/video/123' }]
    };
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows: [row] };
      }
    };

    const response = await request(createApp({ database })).get('/api/items/88');

    expect(response.status).toBe(200);
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('tl.item_id = i.id');
    expect(sql).toContain('i.is_expansion = true');
    expect(sql).toContain('tl.item_id = i.parent_item_id');
    expect(sql).toContain('not exists');
    expect(sql).toContain('direct_tutorial.item_id = i.id');
    expect(sql).toContain("direct_tutorial.status = 'published'");
    expect(sql).toContain('direct_tutorial.source = tl.source');
    expect(queries[0]?.params).toEqual([88]);
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

  it('records a store item click in the current hourly bucket', async () => {
    const queries: Array<{ params?: unknown[]; sql: string }> = [];
    const database: Database = {
      query: async (sql, params) => {
        queries.push({ params, sql });
        return { rows: [] };
      }
    };

    const response = await request(createApp({ database })).post('/api/store-items/300/clicks');

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(queries).toHaveLength(1);
    const sql = normalizeSql(queries[0]?.sql ?? '');
    expect(sql).toContain('insert into store_item_click_stats');
    expect(sql).toContain('store_item_id, clicked_hour, click_count');
    expect(sql).toContain("values ($1, date_trunc('hour', now()), 1)");
    expect(sql).toContain('on conflict (store_item_id, clicked_hour)');
    expect(sql).toContain('do update set click_count = store_item_click_stats.click_count + 1');
    expect(queries[0]?.params).toEqual([300]);
  });

  it('rejects invalid store item click ids before querying the database', async () => {
    const database: Database = {
      query: async () => {
        throw new Error('should not query');
      }
    };

    const response = await request(createApp({ database })).post('/api/store-items/nope/clicks');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        message: 'id must be a positive integer'
      }
    });
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
