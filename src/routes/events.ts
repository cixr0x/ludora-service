import { Router } from 'express';

import type { Database } from '../db.js';

export function createEventsRouter(database: Database): Router {
  const router = Router();

  router.get('/events/banner', async (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    try {
      const { rows } = await database.query(bannerEventSql);
      response.json({ data: rows[0] ?? null });
    } catch (error) {
      next(new Error('Could not load the event banner', { cause: error }));
    }
  });

  return router;
}

const bannerEventSql = `
  select events.id::text as id,
         name,
         description,
         starts_at,
         ends_at,
         min_price::text as min_price,
         max_price::text as max_price,
         country,
         city,
         venue,
         link,
         time_zone
  from public.events
  where ends_at > now()
    and starts_at < now() + interval '336 hours'
  order by events.starts_at, events.id
  limit 1
`;
