import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/config/env";

/**
 * Prisma 7 no longer takes a connection string in schema.prisma — the
 * runtime client connects through an explicit driver adapter instead (the
 * CLI, for migrate/studio/seed, gets its own connection string from
 * prisma.config.ts). See https://pris.ly/d/prisma7-client-config.
 *
 * Cached on `globalThis` in development so Next.js's hot-reload doesn't
 * open a fresh pool (and a fresh set of Postgres connections) on every
 * edit — the standard Prisma-with-Next.js pattern.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
