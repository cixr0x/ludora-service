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
