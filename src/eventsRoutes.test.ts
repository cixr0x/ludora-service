import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { Database } from './db.js';

const endpoint = '/api/events/banner';

describe('homepage event banner', () => {
  it('returns the first eligible event with a stable string ID and uncached response', async () => {
    const event = {
      id: '9007199254740993',
      name: 'Encuentro de Juegos',
      description: 'Un fin de semana de juegos.',
      starts_at: new Date('2026-11-28T16:00:00Z'),
      ends_at: new Date('2026-11-30T00:00:00Z'),
      min_price: '120.00',
      max_price: null,
      country: 'México',
      city: 'Ciudad de México',
      venue: 'Centro de Exposiciones',
      link: 'https://encuentro.example/',
      time_zone: 'America/Mexico_City'
    };
    const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [event] });
    const response = await request(createApp({ database: { query } })).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      data: {
        ...event,
        starts_at: '2026-11-28T16:00:00.000Z',
        ends_at: '2026-11-30T00:00:00.000Z'
      }
    });
    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0][0].replace(/\s+/g, ' ').trim().toLowerCase();
    expect(sql).toMatch(/^select events\.id::text as id,/);
    expect(sql).toContain('min_price::text as min_price, max_price::text as max_price');
    expect(sql).toMatch(/from public\.events where ends_at > now\(\) and starts_at < now\(\) \+ interval '336 hours' order by events\.starts_at, events\.id limit 1$/);
  });

  it('returns null when there is no qualifying event', async () => {
    const query: Database['query'] = async () => ({ rows: [] });
    const response = await request(createApp({ database: { query } })).get(endpoint);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ data: null });
  });

  it('returns a generic error when the database query fails', async () => {
    const query: Database['query'] = async () => {
      throw new Error('Database connection details');
    };
    const response = await request(createApp({ database: { query } })).get(endpoint);

    expect(response.status).toBe(500);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ error: { message: 'Could not load the event banner' } });
  });

  it('uses the shared public API rate limiter', async () => {
    const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [] });
    const app = createApp({ database: { query }, publicApiRateLimit: { windowMs: 60000, max: 1 } });

    expect((await request(app).get(endpoint)).status).toBe(200);
    expect((await request(app).get(endpoint)).status).toBe(429);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('homepage event banner statistics', () => {
  it.each(['click', 'positive', 'negative', 'dismiss'])('records %s using a parameterized daily upsert', async action => {
    const id = '9223372036854775807';
    const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [{ event_id: id }] });
    const response = await request(createApp({ database: { query } })).post(`/api/events/${id}/stats/${action}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([id, action]);
    const statement = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    expect(statement).toContain('insert into public.event_stats (event_id, date, click, positive, negative, dismiss)');
    expect(statement).toContain("(now() at time zone 'america/mexico_city')::date");
    expect(statement).toContain("where events.id = $1::bigint and events.ends_at > now() and events.starts_at < now() + interval '336 hours'");
    expect(statement).toContain('on conflict (event_id, date) do update');
    for (const counter of ['click', 'positive', 'negative', 'dismiss']) {
      expect(statement).toContain(`($2::text = '${counter}')::integer`);
      expect(statement).toContain(`${counter} = event_stats.${counter} + excluded.${counter}`);
    }
    expect(statement).toMatch(/returning event_id;$/);
  });

  it.each(['0', '01', '-1', '+1', '1.0', '1e3', ' 1', '1\n', '9223372036854775808'])('rejects a noncanonical or out-of-range ID %j', async id => {
    const query = vi.fn<Database['query']>();
    const response = await request(createApp({ database: { query } })).post(`/api/events/${encodeURIComponent(id)}/stats/click`);

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['CLICK', 'impression'])('rejects the unknown action %s', async action => {
    const query = vi.fn<Database['query']>();
    const response = await request(createApp({ database: { query } })).post(`/api/events/1/stats/${action}`);

    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 404 when no eligible event was updated', async () => {
    const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [] });
    const response = await request(createApp({ database: { query } })).post('/api/events/1/stats/click');

    expect(response.status).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns a generic error when recording fails', async () => {
    const query = vi.fn<Database['query']>().mockRejectedValue(new Error('Database connection details'));
    const response = await request(createApp({ database: { query } })).post('/api/events/1/stats/click');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { message: 'Could not record the event banner action' } });
  });

  it('shares the strict API rate limiter across banner actions and event IDs', async () => {
    const query = vi.fn<Database['query']>().mockResolvedValue({ rows: [{ event_id: '1' }] });
    const app = createApp({ database: { query }, publicApiStrictRateLimit: { windowMs: 60000, max: 1 } });

    expect((await request(app).post('/api/events/1/stats/click')).status).toBe(204);
    expect((await request(app).post('/api/events/2/stats/dismiss')).status).toBe(429);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
