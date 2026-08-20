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
 * Run with: npm run test:integration
 * Requires: a reachable Postgres per DATABASE_URL, with the M1 migration
 * applied (`npx prisma migrate deploy`).
 */
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
