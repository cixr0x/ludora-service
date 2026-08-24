import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const siteConfig = readFileSync(new URL('../ops/nginx/ludora.conf', import.meta.url), 'utf8');
const appConfig = readFileSync(new URL('../ops/nginx/ludora-app.conf', import.meta.url), 'utf8');

describe('public Nginx pre-cutover configuration', () => {
  it('keeps the old HTTPS host and stages both new names over HTTP', () => {
    expect(siteConfig).toMatch(/server_name ludora\.bobbycrimson\.com;/);
    expect(siteConfig).toMatch(/server_name ludoradar\.mx www\.ludoradar\.mx;/);
    expect(siteConfig).toMatch(/include \/etc\/nginx\/snippets\/ludora-app\.conf;/);
    expect(siteConfig).not.toMatch(/\/etc\/letsencrypt\/live\/ludoradar\.mx/);
  });

  it('serves only known client routes and returns real unknown-path 404s', () => {
    expect(appConfig).toMatch(/location = \/search/);
    expect(appConfig).toMatch(/location ~ \^\/browse\//);
    expect(appConfig).toMatch(/location = \/privacidad/);
    expect(appConfig).toMatch(/location = \/terminos/);
    expect(appConfig).toMatch(/add_header X-Robots-Tag "noindex, follow" always;/);
    expect(appConfig).toMatch(/location \/ \{\s*return 404;/);
  });

  it('serves generated robots and sitemap files directly', () => {
    expect(appConfig).toMatch(/location = \/robots\.txt/);
    expect(appConfig).toMatch(/location = \/sitemap\.xml/);
    expect(appConfig).toMatch(/try_files \$uri =404;/);
  });

  it('preserves canonical product routing and redirects', () => {
    expect(appConfig).toContain('location ~ ^/game/([0-9]+)/?$');
    expect(appConfig).toContain('rewrite ^/game/([0-9]+)/?$ /api/items/$1/canonical-route break;');
    expect(appConfig).toContain('proxy_pass http://127.0.0.1:4000;');
    expect(appConfig).toContain('location ~ ^/game/[0-9]+/[^/]+$');
    expect(appConfig).toContain('try_files $uri.html =404;');
  });
});
