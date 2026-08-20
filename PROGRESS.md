# PROGRESS — updated at the end of each milestone with what works, what is stubbed, what needs human verification

## Phase 0 — repo scaffold (done)

**Works:**
- Next.js (App Router, TS strict) app builds and runs a placeholder home page.
- `src/config/env.ts` — Zod-validated env, fails fast on invalid/missing vars. Covers `WHATSAPP_PROVIDER`, `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, and MinIO-shaped object storage vars (endpoint/bucket/keys/region/force-path-style).
- `src/config/branding.ts` — sole source of the `"Chowk"` string; covered by a passing Vitest test.
- `prisma/schema.prisma` — datasource/generator only, no models (correct for this phase).
- Vitest, ESLint, `tsc --noEmit`, and `next build` all verified green.

**Stubbed / empty on purpose:** `src/providers/`, `src/services/`, `src/data/`, `src/queue/`, `src/worker/`, `src/lib/auth|logging|validation` — placeholder READMEs/`.gitkeep` only, no code. This is correct per plan; they fill in from M1 onward.

**Needs human verification:**
- Dependency versions were pinned away from `latest` due to compatibility breaks discovered during scaffolding: `typescript` → `^5.9.3` (latest `7.0.2` breaks `typescript-eslint`), `eslint` → `^9.39.5` (latest `10.8.1` breaks `eslint-config-next`'s bundled `eslint-plugin-react`). Confirm these ceilings are still correct before bumping either package later.
- `npm audit` reports 3 high-severity advisories from `deepmerge-ts`, transitive via Prisma's CLI config loader (dev-time only). Not fixed — downgrading Prisma to clear it conflicts with using current-stable. Revisit when Prisma patches it upstream.
- No Node.js is installed on the primary dev machine; all Phase 0 verification (`npm install`/`tsc`/`vitest`/`next build`) ran in a separate cloud agent environment. Local `npm install` still needs to be run wherever development actually happens next.

## M1 — Skeleton and tenancy (done)

**Works:**
- `prisma/schema.prisma` — `Organization` and `User` models plus `Role` enum (`ADMIN`/`AGENT`), matching context.md §7.1 exactly, with the `@@unique([organizationId, email])` / `@@index([organizationId])` constraints. Client regenerated (`npx prisma generate`) and importable.
- `src/lib/prisma.ts` — PrismaClient singleton wired to PostgreSQL through `@prisma/adapter-pg` (Prisma 7 requires a driver adapter for the runtime client — see TODO-VERIFY.md), cached on `globalThis` in dev to survive hot-reload.
- `prisma.config.ts` — Prisma 7's CLI-side config (schema path, migrations path, `db seed` command, datasource URL from `DATABASE_URL`), replacing the pre-7 `datasource { url }` / `package.json#prisma.seed` conventions.
- `prisma/migrations/20260821000000_m1_tenancy/` — hand-placed migration SQL (see TODO-VERIFY.md for how it was generated without a live DB) creating the `Role` enum, `Organization` and `User` tables, indexes, and the FK.
- `src/data/organizations.ts`, `src/data/users.ts` — the data-access layer. Every function reading/writing `User` takes `organizationId: string` as a required first parameter and scopes its Prisma query by it, with exactly one documented exception each (Organization has no organizationId of its own; the M1 login bootstrap searches across orgs by email because there's no session yet at that point — both exceptions are called out explicitly in doc comments, not silent).
- `src/lib/auth/` — `password.ts` (bcryptjs hash/verify), `session.ts` (iron-session encrypted cookie carrying `{ userId, organizationId, role }`), `login.ts` (credential verification + session creation), `guard.ts` (`requireSession`/`requireRole`, used by the dashboard layout and the admin-only placeholder).
- `src/app/login/` — email + password form, server action (`actions.ts`) calling `loginWithPassword`, redirects to `/dashboard` on success or back to `/login?error=...` on failure.
- `src/app/(dashboard)/` — authenticated route group. `layout.tsx` calls `requireSession()`, redirecting anonymous requests to `/login`. `dashboard/page.tsx` is the placeholder home (with a logout button). `admin-only/page.tsx` calls `requireRole("ADMIN")` purely to exercise the role gate end-to-end, per the M1 spec.
- `prisma/seed.ts` — creates 2 organizations (Acme Textiles, Globex Traders) and 4 users (1 ADMIN + 1 AGENT each), all sharing a documented dev-only password (`chowk-dev-password`). Structured with one labeled, appendable section per milestone. Wired as `migrations.seed` in `prisma.config.ts` and as the `npm run seed` script.
- Tests (18, all passing): `src/data/tenancy-isolation.test.ts` is the milestone's "done when" proof — creates users in two orgs against an in-memory fake Prisma client and asserts every org-A-scoped lookup (`getUserById`, `getUserByEmail`, `listUsersInOrg`) comes back empty/absent for org B's data, including the same-email-in-two-orgs edge case. `src/lib/auth/guard.test.ts` proves the role gate: no session → redirect to `/login`; AGENT hitting an ADMIN-only check → redirect to `/dashboard`; ADMIN → passes through. `session.test.ts`, `login.test.ts`, `password.test.ts` cover the rest of the auth path.
- `tsc --noEmit`, `vitest run` (18/18), `eslint`, and `next build` all verified green.

**Stubbed / empty on purpose:** `src/providers/`, `src/queue/`, `src/worker/`, `src/services/` untouched — correctly out of scope until M2. No `Channel`/`Contact`/`Conversation`/`Message` models. No WhatsApp code of any kind.

**Needs human verification (see TODO-VERIFY.md for full detail):**
- No Postgres was reachable in this sandbox. The migration SQL was generated via schema diffing (no live DB needed) but has never actually been applied — run `npx prisma migrate deploy` against a real database and confirm it applies cleanly, then `npm run seed`.
- The cross-tenant isolation test runs against an in-memory fake Prisma client, not real Postgres (see `src/data/testing/fakePrisma.ts` for what that does and doesn't prove). Worth re-running the same assertions against a real database once one is reachable.
- M1's login form is email + password only, with no tenant selector, per spec — this required one documented, narrowly-scoped exception to the "organizationId first" data-layer rule (see `src/data/users.ts`). Worth a deliberate look before this scales past a couple of organizations sharing an email address.

### Post-merge verification (2026-08-21) — closing the M1 verification gap

The two "needs human verification" items above involving real Postgres are now resolved (full detail in TODO-VERIFY.md, annotated in place rather than deleted):

- **Infra stood up for real**: no Docker reachable in this verification environment either, so PostgreSQL 17.5 and Redis (tporadowski's Windows Redis 5.0.14.1 build) were run from standalone binaries — same portable-binary spirit as the earlier Node.js setup. Both started and accepted connections (Postgres: `psql` round-trip; Redis: `redis-cli ping` → `PONG`). `docker-compose.yml` (repo root) now defines `postgres` (16-alpine), `redis` (7-alpine), and `minio` for whenever Docker is actually available, with env vars matching `.env.example`'s shape exactly — `docker compose up -d` is the intended local-dev flow (see the comment block at the top of that file).
- **Migration applied cleanly**: `npx prisma migrate deploy` against the real Postgres instance applied `20260821000000_m1_tenancy` with no changes needed to the migration file itself. Verified via `psql`: `Organization`, `User`, and the `Role` enum (`ADMIN`/`AGENT`) all exist exactly as the schema describes, including the `@@unique([organizationId, email])` index and the FK. Re-verified by dropping the database and re-running `migrate deploy` from empty a second time — not order-dependent on leftover state.
- **Seed script ran for real**: `npm run seed` against the real database produced exactly 2 organizations (Acme Textiles, Globex Traders) and 4 users (1 ADMIN + 1 AGENT per org), confirmed via `psql` query.
- **Real login flow confirmed**: `loginWithPassword` (`src/lib/auth/login.ts`), called with no data-layer mocking, correctly rejects a seeded user's real row with a wrong password and succeeds against the documented dev password (`chowk-dev-password`), establishing a session whose `userId`/`organizationId`/`role` match the real seeded row.
- **New real-DB tests added, existing mocked tests untouched**: `src/data/tenancy-isolation.integration.test.ts` (same assertions as the mocked `tenancy-isolation.test.ts`, but through the real `@/lib/prisma` client) and `src/lib/auth/login.integration.test.ts` (the login smoke test above). Both are excluded from `npm test`/`vitest run` (still 18/18, no database needed) and instead run via `npm run test:integration` (`vitest.integration.config.ts`) — 4/4 passing against the real database.
- `tsc --noEmit`, `vitest run` (18/18), `eslint`, and `next build` re-verified green after all of the above.
