import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Database } from '../db.js';

const endpoint = '/api/items/discovery/guide';
it.each(['players=0', 'players=4.5', 'players=2&minutes=banana', 'players=2&complexity=99', 'players=2&style=unknown'])('rejects unsupported questionnaire answers %s', async answers => {
  const query = vi.fn<Database['query']>();
  const response = await request(createApp({ database: { query } })).get(endpoint + '?' + answers);
  expect(response.status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});

it('honors group size, maximum duration, learning difficulty, and the canonical interaction mechanic', async () => {
  const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [] });
  const response = await request(createApp({ database: { query } })).get(endpoint + '?players=4&minutes=45&complexity=light&style=cooperative');
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual([]);
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain('i.max_minutes <= $2');
  expect(sql).toContain('i.min_players between 1 and $1');
  expect(sql).toContain('i.max_players >= $1');
  expect(sql).toContain('limit 3');
  expect(params).toEqual([4, 45, 0, 2, 'Cooperative Game']);
});
