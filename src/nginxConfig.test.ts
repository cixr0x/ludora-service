import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const siteConfig = readFileSync(new URL('../ops/nginx/ludora.conf', import.meta.url), 'utf8');
const appConfig = readFileSync(new URL('../ops/nginx/ludora-app.conf', import.meta.url), 'utf8');

describe('public Nginx canonical HTTPS configuration', () => {
  it('serves the application only on the canonical www HTTPS host', () => {
    expect(siteConfig).toMatch(/server_name www\.ludoradar\.mx;[\s\S]*include \/etc\/nginx\/snippets\/ludora-app\.conf;/);
    expect(siteConfig).toMatch(/include \/etc\/nginx\/snippets\/ludora-app\.conf;/);
    expect(siteConfig).toMatch(/ssl_certificate \/etc\/letsencrypt\/live\/ludoradar\.mx\/fullchain\.pem;/);
    expect(siteConfig).toMatch(/ssl_certificate_key \/etc\/letsencrypt\/live\/ludoradar\.mx\/privkey\.pem;/);
  });

  it('redirects apex, legacy, and HTTP requests to the equivalent canonical path', () => {
    expect(siteConfig).toMatch(/server_name ludoradar\.mx;/);
    expect(siteConfig).toMatch(/server_name ludora\.bobbycrimson\.com;/);
    expect(siteConfig).toMatch(/server_name ludoradar\.mx www\.ludoradar\.mx;/);
    expect(siteConfig.match(/return 301 https:\/\/www\.ludoradar\.mx\$request_uri;/g)).toHaveLength(4);
    expect(siteConfig).toMatch(/\/etc\/letsencrypt\/live\/ludora\.bobbycrimson\.com\/fullchain\.pem/);
  });

  it('preserves the legacy certificate webroot renewal challenge', () => {
    expect(siteConfig).toMatch(
      /server_name ludora\.bobbycrimson\.com;[\s\S]*location \^~ \/\.well-known\/acme-challenge\/[\s\S]*root \/var\/www\/html;[\s\S]*try_files \$uri =404;/,
    );
  });

  it('returns 404 for unmatched HTTP and HTTPS hosts', () => {
    expect(siteConfig.match(/default_server/g)?.length).toBeGreaterThanOrEqual(4);
    expect(siteConfig.match(/server_name _;/g)).toHaveLength(2);
    expect(siteConfig.match(/return 404;/g)).toHaveLength(2);
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

  it('redirects invalid public game paths to the landing page without changing API behavior', () => {
    expect(appConfig).toMatch(/location = \/game \{\s*return 302 \/;/);
    expect(appConfig).toMatch(/location = \/game\/ \{\s*return 302 \/;/);
    expect(appConfig).toMatch(/location \/game\/ \{\s*return 302 \/;/);
    expect(appConfig.match(/proxy_intercept_errors on;/g)).toHaveLength(1);
    expect(appConfig.match(/error_page 404 = @invalid_game_redirect;/g)).toHaveLength(2);
    expect(appConfig).toMatch(/location @invalid_game_redirect \{\s*return 302 \/;/);
    expect(appConfig).toMatch(/location \/api\/ \{[\s\S]*?proxy_pass http:\/\/127\.0\.0\.1:4000\/api\/[\s\S]*?\}/);
  });
});
