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
