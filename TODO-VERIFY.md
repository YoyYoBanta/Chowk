# TODO-VERIFY — uncertain Meta WhatsApp Cloud API details flagged here instead of guessed

## M1 — Skeleton and tenancy

- **No reachable Postgres in this sandbox.** `npx prisma migrate dev` needs
  a live database connection and none is available here (no `psql`, no
  `docker`, port 5432 not listening). The migration SQL was instead
  generated via `npx prisma migrate diff --from-empty --to-schema=prisma/schema.prisma --script`,
  which diffs the schema without needing a live connection, and hand-placed
  into `prisma/migrations/20260821000000_m1_tenancy/migration.sql` +
  `prisma/migrations/migration_lock.toml` in the standard Prisma migration
  folder shape. **The maintainer must run `npx prisma migrate deploy` (or
  `migrate dev` for further schema iteration) against a real Postgres
  instance** — this has not been applied to any real database and needs
  human verification that it actually applies cleanly.
  ~~**VERIFIED 2026-08-21**: applied cleanly with `npx prisma migrate
  deploy` against a real PostgreSQL 17.5 instance (standalone Windows
  binaries, no Docker reachable in that verification environment either —
  see PROGRESS.md; `docker-compose.yml` now provides the Docker path for
  whenever it is available). Confirmed via `psql \dt` / `\d "User"` /
  `\dT+ "Role"` that `Organization`, `User`, and the `Role` enum land
  exactly as the schema describes, and re-verified by dropping and
  recreating the database and re-running `migrate deploy` from empty a
  second time (not order-dependent on leftover state). The migration file
  itself was not changed — it applied as-is, first try.~~
- **Cross-tenant isolation test runs against a mock, not real Postgres**,
  for the same reason (see `src/data/testing/fakePrisma.ts` for exactly what
  it does and doesn't prove — it validates the application-level `where`
  scoping in src/data/, not Postgres-level behavior). Once a real database
  is reachable, it would be worth adding a second version of this test that
  runs the same assertions through the real Prisma client, to also catch
  any drift between the fake's semantics and Postgres's.
  ~~**VERIFIED 2026-08-21**: added
  `src/data/tenancy-isolation.integration.test.ts`, running the identical
  assertions through the real `@/lib/prisma` client (no mocking) against
  the same real Postgres instance — 2/2 tests pass. Also added
  `src/lib/auth/login.integration.test.ts`, calling `loginWithPassword`
  against the seeded admin user's real documented dev password
  (`chowk-dev-password`) with a real database round trip; only
  `next/headers`'s `cookies()` is stubbed (with a plain in-memory jar,
  same narrow workaround `session.test.ts`/`login.test.ts` already use)
  because it throws outside a real Next.js request — iron-session, bcrypt,
  Prisma, and the database are all real. 2/2 pass, including the session
  round-trip (`getCurrentSession()` returns the real seeded user's
  `userId`/`organizationId`/`role`). Both integration files are excluded
  from the default `npm test` / `vitest run` (see `vitest.config.ts`'s
  `exclude` and the new `vitest.integration.config.ts`) and run instead via
  `npm run test:integration` — the fast mocked suite (18/18) is unaffected
  and still requires no database.~~
- **The M1 migration file was left completely untouched** — it applied
  cleanly on the first try against real Postgres, so there was nothing to
  fix here. Noted only so it's clear this was checked, not assumed.
- **Prisma 7 breaking change discovered during this milestone**: the
  `datasource { url = env(...) }` form used in Phase 0's schema is no
  longer valid — Prisma 7 requires the connection string to come from a
  driver adapter (`@prisma/adapter-pg`, added this milestone) for the
  runtime client, and from `prisma.config.ts` for the CLI. Confirmed
  against the Prisma 7 docs; flagging here in case the maintainer's own
  Prisma familiarity predates this change.
- Login is email + password only (per the M1 spec), with no organization
  selector in the UI — see the exception documented in
  `src/data/users.ts` (`findCandidateUsersByEmailForLogin`) for how this
  was reconciled with the "organizationId first, always" data-layer rule.
  Worth a deliberate look before M2: is a tenant selector (subdomain,
  slug, or explicit field) wanted before this scales past a couple of
  organizations sharing an email address?
