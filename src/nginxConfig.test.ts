import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public nginx product routes', () => {
  const source = readFileSync(new URL('../ops/nginx/ludora.conf', import.meta.url), 'utf8');

  it('proxies legacy numeric product URLs to the canonical redirect resolver', () => {
    expect(source).toContain('location ~ ^/game/([0-9]+)/?$');
    expect(source).toContain('rewrite ^/game/([0-9]+)/?$ /api/items/$1/canonical-route break;');
    expect(source).toContain('proxy_pass http://127.0.0.1:4000;');
  });

  it('serves only generated extensionless product pages and returns real 404s otherwise', () => {
    expect(source).toContain('location ~ ^/game/[0-9]+/[^/]+$');
    expect(source).toContain('try_files $uri.html =404;');
  });
});
