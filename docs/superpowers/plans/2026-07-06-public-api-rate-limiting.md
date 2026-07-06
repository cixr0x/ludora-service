# Public API Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable `express-rate-limit` protection to the public `ludora-service` API.

**Architecture:** `ludora-service` will load rate limit settings from environment variables and apply `express-rate-limit` middleware to `/api` routes. `/api/health` is skipped, while contact submissions, store item click tracking, and semantic search receive stricter limits.

**Tech Stack:** Node.js, TypeScript, Express 5, `express-rate-limit@8.5.2`, Vitest, Supertest.

---

## File Structure

- Modify `package.json` and `package-lock.json`: add `express-rate-limit@8.5.2`.
- Modify `src/config.ts`: add public API rate limit config and `TRUST_PROXY` parsing.
- Modify `src/config.test.ts`: cover rate limit defaults, overrides, invalid numeric values, and trust proxy parsing.
- Create `src/rateLimit.ts`: export focused middleware factory functions for general and strict public API limits.
- Modify `src/app.ts`: accept rate limit config, set `trust proxy`, mount general limiter under `/api`, mount strict limiter before sensitive public routes, and keep health unthrottled.
- Modify `src/app.test.ts`: add Supertest coverage for general throttling, strict throttling, health skip, and JSON `429` responses.

### Task 1: Add Config Tests

**Files:**
- Modify: `src/config.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that expect:

```ts
expect(loadConfig().publicApiRateLimit).toEqual({
  windowMs: 60000,
  max: 120
});
expect(loadConfig().publicApiStrictRateLimit).toEqual({
  windowMs: 60000,
  max: 20
});
expect(loadConfig().trustProxy).toBe(false);
```

Add an override test:

```ts
vi.stubEnv('PUBLIC_API_RATE_LIMIT_WINDOW_MS', '30000');
vi.stubEnv('PUBLIC_API_RATE_LIMIT_MAX', '40');
vi.stubEnv('PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS', '45000');
vi.stubEnv('PUBLIC_API_STRICT_RATE_LIMIT_MAX', '8');
vi.stubEnv('TRUST_PROXY', 'true');

expect(loadConfig().publicApiRateLimit).toEqual({ windowMs: 30000, max: 40 });
expect(loadConfig().publicApiStrictRateLimit).toEqual({ windowMs: 45000, max: 8 });
expect(loadConfig().trustProxy).toBe(true);
```

Add invalid value tests:

```ts
vi.stubEnv('PUBLIC_API_RATE_LIMIT_MAX', '0');
expect(() => loadConfig()).toThrow('PUBLIC_API_RATE_LIMIT_MAX must be a positive integer');

vi.stubEnv('TRUST_PROXY', 'sometimes');
expect(() => loadConfig()).toThrow('TRUST_PROXY must be true or false');
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/config.test.ts
```

Expected: config tests fail because the new config fields do not exist.

### Task 2: Implement Config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add config types and readers**

Add these fields to `Config`:

```ts
publicApiRateLimit: {
  max: number;
  windowMs: number;
};
publicApiStrictRateLimit: {
  max: number;
  windowMs: number;
};
trustProxy: boolean;
```

Add constants:

```ts
const DEFAULT_PUBLIC_API_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_PUBLIC_API_RATE_LIMIT_MAX = 120;
const DEFAULT_PUBLIC_API_STRICT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_PUBLIC_API_STRICT_RATE_LIMIT_MAX = 20;
```

Add helper readers:

```ts
function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name]?.trim();
  const value = rawValue ? Number(rawValue) : defaultValue;

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (!rawValue) {
    return defaultValue;
  }
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}
```

- [ ] **Step 2: Run tests to verify pass**

Run:

```bash
npm test -- src/config.test.ts
```

Expected: all config tests pass.

### Task 3: Add Rate Limit Middleware Tests

**Files:**
- Modify: `src/app.test.ts`

- [ ] **Step 1: Write failing app tests**

Add tests that build `createApp` with small limits:

```ts
const response = await request(
  createApp({
    database: idleDatabase(),
    publicApiRateLimit: { windowMs: 60000, max: 1 }
  })
).get('/api/front-page');
```

Expected behaviors:

- First general request returns `200`.
- Second general request from the same test client returns `429` and `{ error: { message: 'Too many requests' } }`.
- Multiple `/api/health` requests continue to return `200`.
- `POST /api/contact` returns `429` on the second request when `publicApiStrictRateLimit.max` is `1`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/app.test.ts
```

Expected: app tests fail because rate limiting options and middleware do not exist.

### Task 4: Install Dependency And Implement Middleware

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/rateLimit.ts`
- Modify: `src/app.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Install package**

Run:

```bash
npm install express-rate-limit@8.5.2
```

Expected: `package.json` and `package-lock.json` include `express-rate-limit`.

- [ ] **Step 2: Create middleware factory**

Create `src/rateLimit.ts`:

```ts
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

export type RateLimitOptions = {
  max: number;
  windowMs: number;
};

export function createPublicApiRateLimiter(options: RateLimitOptions): RequestHandler {
  return rateLimit({
    legacyHeaders: false,
    max: options.max,
    skip: (request) => request.path === '/health',
    standardHeaders: 'draft-8',
    windowMs: options.windowMs,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          message: 'Too many requests'
        }
      });
    }
  });
}

export function createStrictPublicApiRateLimiter(options: RateLimitOptions): RequestHandler {
  return rateLimit({
    legacyHeaders: false,
    max: options.max,
    standardHeaders: 'draft-8',
    windowMs: options.windowMs,
    handler: (_request, response) => {
      response.status(429).json({
        error: {
          message: 'Too many requests'
        }
      });
    }
  });
}
```

- [ ] **Step 3: Wire app and server**

In `src/app.ts`, add optional `publicApiRateLimit`, `publicApiStrictRateLimit`, and `trustProxy` options. Set `app.set('trust proxy', trustProxy)` only when a boolean is provided. Mount the general limiter with `api.use(createPublicApiRateLimiter(publicApiRateLimit))` before API routers. Mount strict middleware before `createContactRouter` and `createCatalogRouter` by using route-specific `api.use` calls for `/contact`, `/store-items/:id/clicks`, and `/items/semantic-search`.

In `src/server.ts`, pass `config.publicApiRateLimit`, `config.publicApiStrictRateLimit`, and `config.trustProxy` into `createApp`.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- src/app.test.ts src/config.test.ts
```

Expected: app and config tests pass.

### Task 5: Full Verification

**Files:**
- No additional edits expected.

- [ ] **Step 1: Run service tests**

Run:

```bash
npm test
```

Expected: all `ludora-service` tests pass.

- [ ] **Step 2: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: TypeScript build exits with code `0`.
