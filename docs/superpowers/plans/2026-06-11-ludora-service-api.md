# Ludora Service API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public Ludora backend service and connect the frontpage UI to it with static fallback data.

**Architecture:** The backend mirrors `ludora-admin-service`: a dependency-injected Express app, a small `pg` database adapter, route modules, and Vitest/Supertest tests. The frontend gets an API adapter that maps public backend rows into the existing UI component contracts.

**Tech Stack:** Node.js, TypeScript, Express 5, pg, dotenv, cors, Vitest, Supertest, React, Vite.

---

### Task 1: Backend Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Modify: `README.md`

- [ ] Add the same TypeScript/Express/Vitest project structure as `ludora-admin-service`, with package name `ludora-service` and default port `4000`.
- [ ] Run `npm install` to create `package-lock.json`.
- [ ] Run `npm run build` and expect TypeScript to compile once source files exist.

### Task 2: Backend App and Config

**Files:**
- Create: `src/config.ts`
- Create: `src/db.ts`
- Create: `src/app.ts`
- Create: `src/server.ts`
- Create: `src/routes/health.ts`
- Create: `src/config.test.ts`
- Create: `src/db.test.ts`
- Create: `src/app.test.ts`

- [ ] Write tests first for config defaults, CORS behavior, `/api/health`, invalid JSON handling, and `PGSSLMODE=no-verify`.
- [ ] Implement the minimal app/config/database code to pass those tests.

### Task 3: Public Catalog Routes

**Files:**
- Create: `src/routes/catalog.ts`
- Modify: `src/app.test.ts`

- [ ] Write tests first for `/api/front-page`, `/api/items`, `/api/items/:id`, `/api/items/:id/stores`, and `/api/items/:id/taxonomy`.
- [ ] Implement read-only SQL queries based on the admin service and existing schema.
- [ ] Validate positive integer ids and return `404` when item detail queries return no rows.

### Task 4: Frontend API Adapter

**Files:**
- Create: `ludora-ui/src/app/api/catalog.ts`
- Create: `ludora-ui/src/app/data/catalog.ts`
- Modify: `ludora-ui/src/app/pages/Home.tsx`
- Modify: `ludora-ui/src/app/pages/Search.tsx`
- Modify: `ludora-ui/src/app/pages/Browse.tsx`
- Modify: `ludora-ui/src/app/pages/GameDetail.tsx`

- [ ] Add a small fetch client for the public service.
- [ ] Map backend items into the existing `Game` and `GameDetail` contracts.
- [ ] Keep `games.ts` as fallback data if requests fail or return empty data.
- [ ] Update pages to load async catalog data without changing the visual design.

### Task 5: Verification

**Commands:**
- `npm test` in `ludora-service`
- `npm run build` in `ludora-service`
- `npm run build` in `ludora-ui`
- Browser smoke test on the running UI

- [ ] Confirm all verification commands pass.
- [ ] Confirm the UI still renders with backend unavailable through static fallback data.
