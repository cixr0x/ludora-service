import { mkdtemp, mkdir, writeFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createPublishedRouteRouter } from './routes/publishedRoutes.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ludoradar-published-routes-')); roots.push(root);
  const live = join(root, 'live');
  const generation = async (name: string, slug = 'old-name') => {
    const directory = join(root, name), output = join(directory, 'public');
    for (const path of [`game/1/${slug}`, 'juegos-de-mesa', 'juegos-de-mesa/pagina/2', 'categorias', 'categoria/7/estrategia', 'categoria/7/estrategia/pagina/2']) {
      await mkdir(join(output, path, '..'), { recursive: true });
      await writeFile(join(output, `${path}.html`), 'complete generated page');
    }
    await writeFile(join(directory, 'routes.json'), JSON.stringify({ version: 1, generationId: name,
      games: { '1': `/game/1/${slug}` }, catalogPageCount: 2,
      categories: { '7': { canonicalPath: '/categoria/7/estrategia', pageCount: 2 } } }));
    return output;
  };
  const first = await generation('one'); await symlink(first, live, 'junction');
  const app = express(); app.use(createPublishedRouteRouter(live));
  return { root, live, app, first, generation };
}

describe('published canonical routing', () => {
  it('resolves legacy/wrong paths and page-one aliases only to existing generation targets', async () => {
    const { app } = await fixture();
    for (const [path, target] of [
      ['/game/1', '/game/1/old-name'], ['/game/1/new-database-name', '/game/1/old-name'],
      ['/juegos-de-mesa/pagina/1', '/juegos-de-mesa'],
      ['/categoria/7/wrong/pagina/1', '/categoria/7/estrategia'],
      ['/categoria/7/wrong/pagina/2', '/categoria/7/estrategia/pagina/2'],
      ['/categoria/7/estrategia/', '/categoria/7/estrategia'],
    ]) {
      const response = await request(app).get('/published-route').set('X-Ludo-Route', path);
      expect(response.status).toBe(301); expect(response.headers.location).toBe(target);
    }
  });
  it('returns real 404s for invalid, unknown, absent and self-loop targets', async () => {
    const { app, first } = await fixture();
    for (const path of ['/game/0', '/game/2/gone', '/game/01/name', '/game/1/old-name', '/game/nope',
      '/juegos-de-mesa/pagina/0', '/juegos-de-mesa/pagina/3', '/juegos-de-mesa/pagina/nope',
      '/categoria/7/wrong/pagina/3', '/categoria/9/missing', '/categoria/7/wrong/pagina/0', '/categoria/7/wrong/pagina/1.5']) {
      const response = await request(app).get('/published-route').set('X-Ludo-Route', path);
      expect(response.status).toBe(404); expect(response.headers.location).toBeUndefined();
    }
    await rm(join(first, 'game/1/old-name.html'));
    expect((await request(app).get('/published-route').set('X-Ludo-Route', '/game/1/new-database-name')).status).toBe(404);
  });
  it('invalidates cached routes when the selected generation switches', async () => {
    const { app, live, generation } = await fixture();
    expect((await request(app).get('/published-route').set('X-Ludo-Route', '/game/1')).headers.location).toBe('/game/1/old-name');
    const next = await generation('two', 'renamed');
    await rename(live, `${live}.previous`); await symlink(next, live, 'junction');
    expect((await request(app).get('/published-route').set('X-Ludo-Route', '/game/1')).headers.location).toBe('/game/1/renamed');
  });
});
