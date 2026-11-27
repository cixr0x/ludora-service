import { Router } from 'express';

import { isDatabaseUnavailable, type Database } from '../db.js';

const MAX_EVENT_ID = 9223372036854775807n;
const bannerStatActions = new Set(['click', 'positive', 'negative', 'dismiss', 'impression']);

export function createEventsRouter(database: Database): Router {
  const router = Router();

  router.get('/events/banner', async (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    try {
      const { rows } = await database.query(bannerEventSql);
      response.json({ data: rows[0] ?? null });
    } catch (error) {
      next(isDatabaseUnavailable(error) ? error : new Error('Could not load the event banner', { cause: error }));
    }
  });

  router.post('/events/:id/stats/:action', async (request, response, next) => {
    const { id, action } = request.params;
    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > MAX_EVENT_ID || !bannerStatActions.has(action)) {
      response.status(400).json({ error: { message: 'Invalid event ID or action' } });
      return;
    }

    try {
      const { rows } = await database.query(recordBannerStatSql, [id, action]);
      if (rows.length === 0) {
        response.status(404).json({ error: { message: 'Event not found' } });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(isDatabaseUnavailable(error) ? error : new Error('Could not record the event banner action', { cause: error }));
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

const recordBannerStatSql = `insert into public.event_stats (event_id, date, click, positive, negative, dismiss, impression)
select events.id,
       (now() at time zone 'America/Mexico_City')::date,
       ($2::text = 'click')::integer,
       ($2::text = 'positive')::integer,
       ($2::text = 'negative')::integer,
       ($2::text = 'dismiss')::integer,
       ($2::text = 'impression')::integer
from public.events
where events.id = $1::bigint
  and events.ends_at > now()
  and events.starts_at < now() + interval '336 hours'
on conflict (event_id, date) do update
set click = event_stats.click + excluded.click,
    positive = event_stats.positive + excluded.positive,
    negative = event_stats.negative + excluded.negative,
    dismiss = event_stats.dismiss + excluded.dismiss,
    impression = event_stats.impression + excluded.impression
returning event_id;`;
