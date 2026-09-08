import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { Database } from '../db.js';

describe('complete SEO export', () => {
  it('captures the maximum eligible ID and exports bounded batches with relationships and original timestamps', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const replies = [
      [{ max_id: '90' }],
      [{ id: '77', canonical_name: 'Sushi Go Party!', updated_at: '2026-09-01T00:00:00Z', categories: [] }],
      [{ item_id: '77', id: '12', store_id: '7', store_active: true, listing_status: 'LISTED',
        availability: 'unknown', language: null, price: '350', currency: 'MXN',
        last_updated: '2026-09-02T00:00:00Z', last_seen_at: '2026-09-03T00:00:00Z', refreshed_date: '2026-09-01T12:00:00Z' }],
      [{ item_id: '77', id: '80', canonical_name: 'Related game' }],
      [{ item_id: '77', id: '81', canonical_name: 'Expansion' }]
    ];
    const database: Database = { query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: replies.shift() ?? [] };
    } };
    const response = await request(createApp({ database })).get('/api/items/prerender?after_id=0&limit=200');
    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ max_id: 90, export_version: 2, after_id: 0, next_after_id: 77, count: 1, limit: 200 });
    expect(response.body.data[0]).toMatchObject({
      canonical_path: '/game/77/sushi-go-party', updated_at: '2026-09-01T00:00:00Z',
      offers: [{ id: '12', language: null, availability: 'unknown', refreshed_date: '2026-09-01T12:00:00Z' }],
      related_items: [{ id: '80', canonical_name: 'Related game' }],
      expansion_items: [{ id: '81', canonical_name: 'Expansion' }]
    });
    expect(calls).toHaveLength(5);
    expect(calls[1].params).toEqual([200, 0, 90]);
    expect(calls[1].sql).toContain('i.id <= $3');
    expect(calls.slice(2).every(call => JSON.stringify(call.params?.[0]) === '[77]')).toBe(true);
  });

  it('uses the caller frozen maximum without recapturing and returns an explicit end-of-feed', async () => {
    const calls: unknown[][] = [];
    const database: Database = { query: async (_sql, params) => { calls.push(params ?? []); return { rows: [] }; } };
    const response = await request(createApp({ database })).get('/api/items/prerender?after_id=90&maxId=90');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], meta: {
      after_id: 90, count: 0, limit: 200, next_after_id: 90, pagination: 'keyset', max_id: 90, export_version: 2
    } });
    expect(calls).toEqual([[200, 90, 90]]);
  });

  it('groups shared bundle membership once per game and keeps relationship rankings in batch order', async () => {
    const replies = [
      [{ id: 1, canonical_name: 'First game' }, { id: 2, canonical_name: 'Second game' }],
      [{ item_id: 1, id: 11, is_bundle: true }, { item_id: 2, id: 11, is_bundle: true }, { item_id: 2, id: 12, is_bundle: false }],
      [{ item_id: 1, id: 30, canonical_name: 'Higher score' }, { item_id: 1, id: 20, canonical_name: 'Lower score' }],
      [{ item_id: 2, id: 40, canonical_name: 'Expansion' }]
    ];
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const database: Database = { query: async (sql, params) => {
      calls.push({ sql, params }); return { rows: replies.shift() ?? [] };
    } };
    const response = await request(createApp({ database })).get('/api/items/prerender?after_id=0&maxId=90');
    expect(response.status).toBe(200);
    expect(response.body.data.map((item: any) => item.offers.map((offer: any) => offer.id))).toEqual([[11], [11, 12]]);
    expect(response.body.data[0].related_items.map((item: any) => item.id)).toEqual([30, 20]);
    expect(response.body.data[0].expansion_items).toEqual([]);
    expect(response.body.data[1].expansion_items).toEqual([{ id: 40, canonical_name: 'Expansion' }]);
    expect(calls).toHaveLength(4);
    expect(calls[1].params).toEqual([[1, 2]]);
    expect(calls[2].params).toEqual([[1, 2], 90, 18]);
    expect(calls[3].params).toEqual([[1, 2], 90, 18]);
  });

  it.each(['after_id=nope', 'after_id=-1', 'after_id=2.5', 'after_id=1&after_id=2', 'after_id=',
    'maxId=nope', 'maxId=-1', 'maxId=9007199254740992', 'after_id=3&maxId=2'])('rejects malformed cursors: %s', async (query) => {
    let calls = 0;
    const database: Database = { query: async () => { calls++; return { rows: [] }; } };
    const response = await request(createApp({ database })).get(`/api/items/prerender?${query}`);
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });

  it.each([
    [{ id: 1, canonical_name: 'First' }, { id: 1, canonical_name: 'Duplicate' }],
    [{ id: 0, canonical_name: 'Invalid' }],
    [{ id: 91, canonical_name: 'Past cap' }],
    [{ id: 1, canonical_name: '' }]
  ])('rejects malformed or duplicate export records', async (...rows) => {
    const database: Database = { query: async () => ({ rows }) };
    const response = await request(createApp({ database })).get('/api/items/prerender?after_id=0&maxId=90');
    expect(response.status).toBe(500);
  });

  it('exports the additive offer fields from item detail too', async () => {
    let query = '';
    const database: Database = { query: async (sql) => { query = sql; return { rows: [{ id: 77, offers: [{ language: null, refreshed_date: null }] }] }; } };
    const response = await request(createApp({ database })).get('/api/items/77');
    expect(response.status).toBe(200);
    expect(response.body.data.offers).toEqual([{ language: null, refreshed_date: null }]);
    expect(query).toContain("'language', si.language");
    expect(query).toContain("'refreshed_date', si.refreshed_date");
    expect(query).toContain("'last_updated', si.last_updated");
  });
});
