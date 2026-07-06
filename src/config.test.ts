import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults PORT to 4000 when unset', () => {
    vi.stubEnv('PORT', undefined);

    expect(loadConfig().port).toBe(4000);
  });

  it.each(['abc', '0', '-1', '4000.5'])('rejects invalid PORT %s', (port) => {
    vi.stubEnv('PORT', port);

    expect(() => loadConfig()).toThrow('PORT must be a positive integer');
  });

  it('allows local UI dev origins by default', () => {
    vi.stubEnv('CORS_ORIGIN', undefined);

    expect(loadConfig().corsOrigin).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174'
    ]);
  });

  it('merges comma-separated CORS origins from env with local UI defaults', () => {
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:5173, http://127.0.0.1:5173');

    expect(loadConfig().corsOrigin).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5174'
    ]);
  });

  it('loads the database URL from env', () => {
    vi.stubEnv('LUDORA_DATABASE_URL', 'postgresql://example');

    expect(loadConfig().databaseUrl).toBe('postgresql://example');
  });

  it('loads OpenAI embedding configuration from env', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large');

    expect(loadConfig().openAiApiKey).toBe('sk-test');
    expect(loadConfig().embeddingModel).toBe('text-embedding-3-large');
  });

  it('defaults the embedding model to text-embedding-3-small', () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', undefined);

    expect(loadConfig().embeddingModel).toBe('text-embedding-3-small');
  });

  it('defaults public API rate limits and proxy trust', () => {
    vi.stubEnv('PUBLIC_API_RATE_LIMIT_WINDOW_MS', undefined);
    vi.stubEnv('PUBLIC_API_RATE_LIMIT_MAX', undefined);
    vi.stubEnv('PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS', undefined);
    vi.stubEnv('PUBLIC_API_STRICT_RATE_LIMIT_MAX', undefined);
    vi.stubEnv('TRUST_PROXY', undefined);

    expect(loadConfig().publicApiRateLimit).toEqual({
      windowMs: 60000,
      max: 120
    });
    expect(loadConfig().publicApiStrictRateLimit).toEqual({
      windowMs: 60000,
      max: 20
    });
    expect(loadConfig().trustProxy).toBe(false);
  });

  it('loads public API rate limits and proxy trust from env', () => {
    vi.stubEnv('PUBLIC_API_RATE_LIMIT_WINDOW_MS', '30000');
    vi.stubEnv('PUBLIC_API_RATE_LIMIT_MAX', '40');
    vi.stubEnv('PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS', '45000');
    vi.stubEnv('PUBLIC_API_STRICT_RATE_LIMIT_MAX', '8');
    vi.stubEnv('TRUST_PROXY', 'true');

    expect(loadConfig().publicApiRateLimit).toEqual({ windowMs: 30000, max: 40 });
    expect(loadConfig().publicApiStrictRateLimit).toEqual({ windowMs: 45000, max: 8 });
    expect(loadConfig().trustProxy).toBe(true);
  });

  it.each([
    ['PUBLIC_API_RATE_LIMIT_WINDOW_MS', '0'],
    ['PUBLIC_API_RATE_LIMIT_MAX', '-1'],
    ['PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS', '60000.5'],
    ['PUBLIC_API_STRICT_RATE_LIMIT_MAX', 'abc']
  ])('rejects invalid public API rate limit value %s=%s', (name, value) => {
    vi.stubEnv(name, value);

    expect(() => loadConfig()).toThrow(`${name} must be a positive integer`);
  });

  it('rejects invalid TRUST_PROXY values', () => {
    vi.stubEnv('TRUST_PROXY', 'sometimes');

    expect(() => loadConfig()).toThrow('TRUST_PROXY must be true or false');
  });
});
