/**
 * Local dev seed script. Wired via `prisma.config.ts` (`migrations.seed`,
 * the Prisma 7 convention — package.json's `prisma.seed` field is the
 * pre-7 convention and is no longer read). Run with:
 *
 *   npx prisma db seed
 *
 * Extend this file milestone by milestone: keep each milestone's seed data
 * in its own clearly-labeled, appendable section (see `main()` below)
 * rather than rewriting what's already here. M2+ adds Channel/Contact/
 * Conversation/Message seed data in the same style.
 *
 * Passwords below are fixed, documented, local-dev-only values — never
 * real secrets, never used outside a local/dev database.
 */
import { prisma } from "../src/lib/prisma";
import { createOrganization } from "../src/data/organizations";
import { createUser } from "../src/data/users";
import { hashPassword } from "../src/lib/auth/password";

const DEV_PASSWORD = "chowk-dev-password";

async function seedM1TenancyAndUsers(): Promise<void> {
  const acme = await createOrganization("Acme Textiles");
  const globex = await createOrganization("Globex Traders");

  const passwordHash = await hashPassword(DEV_PASSWORD);

  await createUser(acme.id, {
    email: "admin@acme.chowk.test",
    name: "Amara Acme",
    passwordHash,
    role: "ADMIN",
  });
  await createUser(acme.id, {
    email: "agent@acme.chowk.test",
    name: "Amit Acme",
    passwordHash,
    role: "AGENT",
  });

  await createUser(globex.id, {
    email: "admin@globex.chowk.test",
    name: "Gabi Globex",
    passwordHash,
    role: "ADMIN",
  });
  await createUser(globex.id, {
    email: "agent@globex.chowk.test",
    name: "Gus Globex",
    passwordHash,
    role: "AGENT",
  });

  console.log("Seeded M1: 2 organizations (Acme Textiles, Globex Traders), 4 users.");
  console.log(`All seeded users share the dev password: "${DEV_PASSWORD}"`);
}

async function main(): Promise<void> {
  // --- M1: tenancy + auth skeleton ---
  await seedM1TenancyAndUsers();

  // --- M2+: append new sections below this line, do not reorder above ---
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
