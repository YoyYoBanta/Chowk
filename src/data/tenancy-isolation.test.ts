import { describe, expect, it, vi } from "vitest";
import { createFakePrismaClient } from "./testing/fakePrisma";

/**
 * The most important test in M1 (context.md's own "done when" bar): two
 * organizations, and a user in one cannot be reached through the other's
 * organizationId. This is the template every later milestone's tenancy
 * test copies, so it deliberately tests the data-access layer directly
 * (src/data/users.ts) rather than through a route/UI — that's the actual
 * enforcement point per architecture.md §12, not the UI.
 *
 * No reachable Postgres in this sandbox (see PROGRESS.md), so `@/lib/prisma`
 * is replaced with the in-memory fake from ./testing/fakePrisma — see that
 * file's doc comment for exactly what this does and doesn't prove.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: createFakePrismaClient(),
}));

const { createOrganization } = await import("./organizations");
const {
  createUser,
  getUserById,
  getUserByEmail,
  listUsersInOrg,
  findCandidateUsersByEmailForLogin,
} = await import("./users");

describe("cross-tenant isolation", () => {
  it("never returns Org B's user through a lookup scoped to Org A", async () => {
    const orgA = await createOrganization("Org A");
    const orgB = await createOrganization("Org B");

    const userA = await createUser(orgA.id, {
      email: "alice@org-a.test",
      passwordHash: "hash-a",
      name: "Alice",
      role: "ADMIN",
    });
    const userB = await createUser(orgB.id, {
      email: "bob@org-b.test",
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
      email: "alice@org-a.test",
    });

    // Org B's email doesn't leak into an Org A-scoped email lookup either.
    await expect(getUserByEmail(orgA.id, "bob@org-b.test")).resolves.toBeNull();
    await expect(getUserByEmail(orgA.id, "alice@org-a.test")).resolves.toMatchObject({
      id: userA.id,
    });

    // The org's own user listing never includes the other org's rows.
    const orgAUsers = await listUsersInOrg(orgA.id);
    expect(orgAUsers).toHaveLength(1);
    expect(orgAUsers.map((u) => u.id)).not.toContain(userB.id);

    const orgBUsers = await listUsersInOrg(orgB.id);
    expect(orgBUsers).toHaveLength(1);
    expect(orgBUsers.map((u) => u.id)).not.toContain(userA.id);
  });

  it("same email in two orgs stays scoped to the right one", async () => {
    const orgA = await createOrganization("Org C");
    const orgB = await createOrganization("Org D");

    const sharedEmail = "shared@example.test";
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
    // across organizations — it should surface both candidates so the
    // password check can disambiguate.
    const candidates = await findCandidateUsersByEmailForLogin(sharedEmail);
    expect(candidates.map((u) => u.id).sort()).toEqual(
      [userInA.id, userInB.id].sort(),
    );
  });
});
