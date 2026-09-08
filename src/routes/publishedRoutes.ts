import { Router } from 'express';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';

type PublishedRoutes = { version: number; games: Record<string, string>; catalogPageCount: number;
  categories: Record<string, { canonicalPath: string; pageCount: number }> };

export function createPublishedRouteRouter(livePath = process.env.LUDORA_SEO_LIVE_PATH ?? '/opt/ludora/ludora-ui/dist'): Router {
  const router = Router();
  let cached: { directory: string; routes: PublishedRoutes } | undefined;
  router.get('/published-route', async (request, response, next) => {
    try {
      const raw = request.get('X-Ludo-Route');
      if (!raw || raw.length > 1024) { response.status(404).end(); return; }
      const path = raw.split('?')[0];
      const directory = await realpath(livePath);
      if (cached?.directory !== directory) {
        const routes = JSON.parse(await readFile(join(directory, '..', 'routes.json'), 'utf8')) as PublishedRoutes;
        if (routes.version !== 1 || !routes.games || !routes.categories) throw new Error('Invalid published route registry');
        cached = { directory, routes };
      }
      const canonical = resolvePublishedPath(path, cached.routes);
      if (!canonical || canonical === path) { response.status(404).end(); return; }
      const file = await realpath(join(directory, `${canonical.slice(1)}.html`));
      const within = relative(directory, file);
      if (within.startsWith('..') || isAbsolute(within) || !(await stat(file)).isFile()) { response.status(404).end(); return; }
      response.redirect(301, canonical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { response.status(404).end(); return; }
      next(error);
    }
  });
  return router;
}

function resolvePublishedPath(path: string, routes: PublishedRoutes): string | undefined {
  const game = path.match(/^\/game\/([1-9][0-9]*)(?:\/[a-zA-Z0-9-]+)?\/?$/);
  if (game) {
    const target = routes.games[game[1]];
    return typeof target === 'string' && new RegExp(`^/game/${game[1]}/[a-z0-9-]+$`).test(target) ? target : undefined;
  }
  if (/^\/categorias\/?$/.test(path)) return '/categorias';
  const catalog = path.match(/^\/juegos-de-mesa(?:\/pagina\/([1-9][0-9]*))?\/?$/);
  if (catalog) {
    const page = Number(catalog[1] ?? 1);
    return Number.isSafeInteger(page) && page <= routes.catalogPageCount
      ? page === 1 ? '/juegos-de-mesa' : `/juegos-de-mesa/pagina/${page}` : undefined;
  }
  const category = path.match(/^\/categoria\/([1-9][0-9]*)\/[a-zA-Z0-9-]+(?:\/pagina\/([1-9][0-9]*))?\/?$/);
  if (category) {
    const entry = routes.categories[category[1]], page = Number(category[2] ?? 1);
    if (!entry || !Number.isSafeInteger(page) || page > entry.pageCount ||
      !new RegExp(`^/categoria/${category[1]}/[a-z0-9-]+$`).test(entry.canonicalPath)) return undefined;
    return page === 1 ? entry.canonicalPath : `${entry.canonicalPath}/pagina/${page}`;
  }
  return undefined;
}
