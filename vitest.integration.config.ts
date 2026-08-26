import "dotenv/config";
import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Separate config for the real-database integration tests
 * (`src/**\/*.integration.test.ts`), kept apart from vitest.config.ts on
 * purpose:
 *
 * - vitest.config.ts hardcodes dummy env values so the fast/mocked suite
 *   (`npm test`) never needs a `.env` file or a reachable database — that
 *   must keep working in a fresh clone with nothing running locally.
 * - This config instead loads the real `.env` (via `dotenv/config`), so
 *   `DATABASE_URL` etc. point at whatever Postgres the developer/CI has
 *   actually started (see docker-compose.yml). These tests hit that
 *   database for real through `@/lib/prisma` — no mocking of Prisma.
 *
 * `DATABASE_URL` is then rewritten below to a `_test`-suffixed database
 * name — see the override for why this stopped being optional.
 *
 * Run with: npm run test:integration
 * Requires: a reachable Postgres per DATABASE_URL (database name
 * `_test`-suffixed — see below), with every migration applied
 * (`npx prisma migrate deploy`).
 */

// Real bug this fixed (2026-08-24): every integration test's own
// afterAll cleanup is best-effort, not guaranteed — an interrupted run
// (a crashed process, a killed background test runner) can leave fixture
// orgs/contacts/messages behind. Before this override, `DATABASE_URL`
// was whatever `.env` pointed at, the SAME database `npm run dev`/
// `npm run worker` use — so a leftover fixture from
// `messages.search.integration.test.ts`'s 10,000+-row load test actually
// showed up as a garbled contact name in the live local inbox. Tests now
// always run against a dedicated `<db>_test` database instead, so a
// failed cleanup can never again leak into whatever the developer is
// looking at in their browser. Applied unconditionally — this suite's
// whole purpose is destructive, org-scoped Postgres writes, so there is
// no legitimate reason for it to ever target the dev database.
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  if (!url.pathname.endsWith("_test")) {
    url.pathname = `${url.pathname}_test`;
  }
  process.env.DATABASE_URL = url.toString();
}
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Real DB round-trips (connect, apply queries, clean up) are slower
    // than the in-memory fake — give them more room than the default 5s.
    testTimeout: 20_000,
  },
});
