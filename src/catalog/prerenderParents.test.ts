import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { Database } from '../db.js';

const fixture = readFileSync(new URL('./fixtures/prerenderParents.sql', import.meta.url), 'utf8');
const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const fixtureJoin = (name: string) => {
  const join = fixture.split(`-- BEGIN ${name} JOIN`)[1]?.split(`-- END ${name} JOIN`)[0];
  if (!join) throw new Error(`Missing ${name} parity fixture join`);
  return normalizeSql(join);
};

describe('prerender parent lookup', () => {
  it.each(['after_id=0', 'offset=0'])('uses the parity-verified candidate ID lookup for %s', async pagination => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const parentItems = [{ id: 101, canonical_name: 'Zeta', canonical_name_es: 'Alpha' }];
    const database: Database = { query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: sql.includes('with prerender_page as')
        ? [{ id: 1, canonical_name: 'Expansion', parent_items: parentItems }] : [] };
    } };

    const response = await request(createApp({ database }))
      .get(`/api/items/prerender?${pagination}&maxId=200&limit=50`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].parent_items).toEqual(parentItems);
    expect(calls).toHaveLength(4);
    expect(calls[0].params).toEqual([50, 0, 200]);
    const sql = normalizeSql(calls[0].sql);
    expect(sql).toContain(fixtureJoin('EXPORT'));
    expect(sql).not.toContain(fixtureJoin('ORIGINAL'));
    expect(sql).not.toContain('from active_item parent where');
  });

  it('keeps the original item-detail parent query unchanged and bound to the relational fixture', async () => {
    let query = '';
    const database: Database = { query: async sql => {
      query = sql;
      return { rows: [{ id: 1, canonical_name: 'Expansion', parent_items: [] }] };
    } };

    const response = await request(createApp({ database })).get('/api/items/1');

    expect(response.status).toBe(200);
    expect(normalizeSql(query)).toContain(fixtureJoin('ORIGINAL'));
    expect(normalizeSql(query)).not.toContain(fixtureJoin('EXPORT'));
  });
});
