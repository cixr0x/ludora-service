import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { Database } from '../db.js';

const fixture = readFileSync(new URL('./fixtures/itemOffers.sql', import.meta.url), 'utf8');
const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const fixtureJoin = (name: string) => {
  const join = fixture.split(`-- BEGIN ${name} JOIN`)[1]?.split(`-- END ${name} JOIN`)[0];
  if (!join) throw new Error(`Missing ${name} offer parity fixture join`);
  return normalizeSql(join);
};

describe('item-detail offer lookup', () => {
  it('uses the parity fixture candidate lookup for primary and bundle offers', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const database: Database = { query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: 3, offers: [] }] };
    } };

    const response = await request(createApp({ database })).get('/api/items/3');

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([3]);
    expect(normalizeSql(calls[0].sql)).toContain(fixtureJoin('OPTIMIZED'));
    expect(normalizeSql(calls[0].sql)).not.toContain(fixtureJoin('ORIGINAL'));
  });
});
