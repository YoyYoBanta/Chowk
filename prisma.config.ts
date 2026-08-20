import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the connection string for the CLI (migrate/studio/db seed)
// out of schema.prisma and into this file. The app's own runtime connection
// (via PrismaClient + a driver adapter) is configured separately in
// src/lib/prisma.ts and reads DATABASE_URL through src/config/env.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
