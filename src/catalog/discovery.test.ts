import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Database } from '../db.js';

const endpoint = '/api/items/discovery';

it.each([
  'mode=mix&ids=7', 'mode=mix&ids=7,7', 'mode=mix&ids=1,2,3,4',
  'mode=similar&ids=1,2', 'mode=similar&ids=-7', 'mode=mix&ids=7,1e2',
  'mode=similar&ids=9007199254740992', 'mode=other&ids=7',
])('rejects invalid discovery input %s before querying', async queryString => {
  const query = vi.fn<Database['query']>();
  const response = await request(createApp({ database: { query } })).get(endpoint + '?' + queryString);
  expect(response.status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});

it('returns a missing-seed error instead of silently changing a mix', async () => {
  const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [{ seeds: [{ id: 7 }], results: [] }] });
  const response = await request(createApp({ database: { query } })).get(endpoint + '?mode=mix&ids=7,8');
  expect(response.status).toBe(404);
});

it('returns a valid empty mixture with ordered seeds and a bounded recommendation query', async () => {
  const data = { seeds: [{ id: 8, canonical_name: 'B' }, { id: 7, canonical_name: 'A' }], results: [] };
  const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [data] });
  const response = await request(createApp({ database: { query } })).get(endpoint + '?mode=mix&ids=8,7');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ data });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1]).toEqual([[8, 7], 24]);
});

it('counts a shared generic mechanic once and assigns distinct evidence to as many seeds as possible', async () => {
  const solo = { id: 1, kind: 'mechanic', name: 'Solo' };
  const deck = { id: 2, kind: 'mechanic', name: 'Deck' };
  const worker = { id: 3, kind: 'mechanic', name: 'Worker' };
  const seeds = [{ id: 7 }, { id: 8 }, { id: 9 }];
  const results = [
    { id: 10, sources: [{ seed_id: 7, traits: [deck, solo] }, { seed_id: 8, traits: [worker, solo] }, { seed_id: 9, traits: [solo] }] },
    { id: 11, sources: [{ seed_id: 7, traits: [solo, deck] }, { seed_id: 8, traits: [solo] }, { seed_id: 9, traits: [solo] }] },
  ];
  const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [{ seeds, results }] });
  const response = await request(createApp({ database: { query } })).get(endpoint + '?mode=mix&ids=7,8,9');
  expect(response.body.data.results.map((result: typeof results[number]) => result.sources)).toEqual([
    [{ seed_id: 7, traits: [deck] }, { seed_id: 8, traits: [worker] }, { seed_id: 9, traits: [solo] }],
    [{ seed_id: 7, traits: [deck] }, { seed_id: 8, traits: [solo] }],
  ]);
});
