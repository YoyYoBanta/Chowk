import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Real-database integration tests (see vitest.integration.config.ts /
    // `npm run test:integration`) live alongside their mocked counterparts
    // but must never be picked up here — this is the suite that has to
    // pass in a fresh clone with no database running.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
    // src/config/env.ts validates process.env at import time and throws on
    // anything missing/invalid. Tests must be able to run in a fresh clone
    // with no local .env file (which is gitignored), so provide dummy —
    // but schema-valid — values here rather than depending on one existing.
    env: {
      WHATSAPP_PROVIDER: "baileys",
      DATABASE_URL: "postgresql://user:password@localhost:5432/chowk_test",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "test-only-secret-at-least-32-characters-long",
      OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
      OBJECT_STORAGE_BUCKET: "chowk-test",
      OBJECT_STORAGE_ACCESS_KEY: "test-access-key",
      OBJECT_STORAGE_SECRET_KEY: "test-secret-key",
    },
  },
});
