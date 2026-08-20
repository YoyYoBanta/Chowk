import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "./organizations";
import {
  createUser,
  getUserByEmail,
  getUserById,
  listUsersInOrg,
  findCandidateUsersByEmailForLogin,
} from "./users";

/**
 * Real-database counterpart to tenancy-isolation.test.ts.
 *
 * That test proves the same assertions against an in-memory fake Prisma
 * client (see src/data/testing/fakePrisma.ts) because M1 was built with no
 * reachable Postgres. It is NOT replaced here — it stays as the fast unit
 * test every later milestone's tenancy test copies. This file instead runs
 * the identical class of assertions through the *real* `@/lib/prisma`
 * client (no mocking at all) against a real Postgres instance, which is the
 * only way to actually prove the Prisma 7 + `@prisma/adapter-pg` driver
 * adapter + live-database path works end to end — something the fake
 * structurally cannot prove (see its doc comment).
 *
 * Kept out of the default `npm test` / `vitest run` suite (see
 * vitest.config.ts's `exclude` and vitest.integration.config.ts) so the
 * fast unit-test loop never silently requires a database. Run with:
 *
 *   npm run test:integration
 *
 * ...against a Postgres reachable at DATABASE_URL (see docker-compose.yml
 * for the local-dev way to get one: `docker compose up -d`) with the M1
 * migration already applied (`npx prisma migrate deploy`).
 *
 * Test data uses random suffixes and is cleaned up in `afterAll` so this
 * file is safe to re-run against a database that also carries the seeded
 * M1 demo data (`npm run seed`).
 */

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeOrg(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  return org;
}

afterAll(async () => {
  // FK is ON DELETE RESTRICT, so users must go before their organizations.
  await prisma.user.deleteMany({
    where: { organizationId: { in: createdOrgIds } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: createdOrgIds } },
  });
  await prisma.$disconnect();
});

describe("cross-tenant isolation (real Postgres, no mocking)", () => {
  it("never returns Org B's user through a lookup scoped to Org A", async () => {
    const orgA = await makeOrg("Real Org A");
    const orgB = await makeOrg("Real Org B");

    const userA = await createUser(orgA.id, {
      email: `alice-${suffix}@org-a.test`,
      passwordHash: "hash-a",
      name: "Alice",
      role: "ADMIN",
    });
    const userB = await createUser(orgB.id, {
      email: `bob-${suffix}@org-b.test`,
      passwordHash: "hash-b",
      name: "Bob",
      role: "AGENT",
    });

    // Guessing Org B's user id while scoped to Org A must come back empty.
    await expect(getUserById(orgA.id, userB.id)).resolves.toBeNull();
    // ...and the reverse.
    await expect(getUserById(orgB.id, userA.id)).resolves.toBeNull();

    // Scoped-correctly lookups still work.
    await expect(getUserById(orgA.id, userA.id)).resolves.toMatchObject({
      id: userA.id,
      email: `alice-${suffix}@org-a.test`,
    });

    // Org B's email doesn't leak into an Org A-scoped email lookup either.
    await expect(
      getUserByEmail(orgA.id, `bob-${suffix}@org-b.test`),
    ).resolves.toBeNull();
    await expect(
      getUserByEmail(orgA.id, `alice-${suffix}@org-a.test`),
    ).resolves.toMatchObject({ id: userA.id });

    // The org's own user listing never includes the other org's rows.
    const orgAUsers = await listUsersInOrg(orgA.id);
    expect(orgAUsers.map((u) => u.id)).toContain(userA.id);
    expect(orgAUsers.map((u) => u.id)).not.toContain(userB.id);

    const orgBUsers = await listUsersInOrg(orgB.id);
    expect(orgBUsers.map((u) => u.id)).toContain(userB.id);
    expect(orgBUsers.map((u) => u.id)).not.toContain(userA.id);
  });

  it("same email in two orgs stays scoped to the right one", async () => {
    const orgA = await makeOrg("Real Org C");
    const orgB = await makeOrg("Real Org D");

    const sharedEmail = `shared-${suffix}@example.test`;
    const userInA = await createUser(orgA.id, {
      email: sharedEmail,
      passwordHash: "hash-a2",
      name: "Carol (Org C)",
    });
    const userInB = await createUser(orgB.id, {
      email: sharedEmail,
      passwordHash: "hash-b2",
      name: "Carol (Org D)",
    });

    await expect(getUserByEmail(orgA.id, sharedEmail)).resolves.toMatchObject({
      id: userInA.id,
    });
    await expect(getUserByEmail(orgB.id, sharedEmail)).resolves.toMatchObject({
      id: userInB.id,
    });

    // The login bootstrap path is the sole function allowed to search
    // across organizations — it should surface both real rows so the
    // password check can disambiguate.
    const candidates = await findCandidateUsersByEmailForLogin(sharedEmail);
    expect(candidates.map((u) => u.id).sort()).toEqual(
      [userInA.id, userInB.id].sort(),
    );

    // Postgres itself (not just the fake) enforces the compound unique
    // constraint this whole scheme depends on.
    await expect(
      createUser(orgA.id, {
        email: sharedEmail,
        passwordHash: "hash-a3",
        name: "Duplicate in same org",
      }),
    ).rejects.toThrow();
  });
});
