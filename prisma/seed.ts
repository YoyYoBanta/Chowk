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
import { createOrganization, listOrganizations } from "../src/data/organizations";
import { createUser } from "../src/data/users";
import { createChannel, listChannelsInOrg } from "../src/data/channels";
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

/**
 * One Baileys channel per organization that doesn't already have one.
 * Status is DISCONNECTED on purpose — there is no dedicated WhatsApp test
 * number available yet (see TODO-VERIFY.md's M2 section), so seeding an
 * ACTIVE channel here would misrepresent a session that doesn't exist.
 * `phoneNumber` is a placeholder value (display-only field per
 * context.md §7.2) until a real number is assigned to a channel.
 *
 * Written to be safe to re-run: it checks each organization for an
 * existing channel first rather than unconditionally inserting (M1's own
 * org/user seeding above is not itself idempotent — re-running `npm run
 * seed` creates fresh duplicate organizations each time, same as before
 * this milestone — so this only guards its own concern: never adding a
 * second channel to an org row that already has one).
 */
async function seedM2Channels(): Promise<void> {
  const orgs = await listOrganizations();
  let created = 0;

  for (const org of orgs) {
    const existingChannels = await listChannelsInOrg(org.id);
    if (existingChannels.length > 0) continue;

    await createChannel(org.id, {
      displayName: `${org.name} WhatsApp (Baileys, dev)`,
      phoneNumber: "000000000000",
      provider: "baileys",
      status: "DISCONNECTED",
    });
    created += 1;
  }

  console.log(
    `Seeded M2: ${created} Baileys channel(s), status DISCONNECTED (no live session — see TODO-VERIFY.md).`,
  );
}

async function main(): Promise<void> {
  // --- M1: tenancy + auth skeleton ---
  await seedM1TenancyAndUsers();

  // --- M2: provider adapter + ingestion ---
  await seedM2Channels();

  // --- M3+: append new sections below this line, do not reorder above ---
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
