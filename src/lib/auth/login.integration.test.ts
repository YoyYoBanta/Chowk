import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Real-database login smoke test — the thing login.test.ts structurally
 * cannot prove, since that file mocks `@/data/users`, `./password`, and
 * `./session` outright. This file mocks *only* `next/headers`' `cookies()`,
 * and only because it throws when called outside a real Next.js request
 * (App Router's `cookies()` needs request-scoped `AsyncLocalStorage`, which
 * a plain Vitest run doesn't provide) — session.test.ts and login.test.ts
 * already establish this same narrow workaround for the same reason. The
 * fake cookie jar below duck-types the get/set shape iron-session actually
 * calls; iron-session itself, bcrypt password verification, the Prisma
 * query, and the database are all real.
 *
 * Run with: npm run test:integration (see vitest.integration.config.ts).
 * Requires the M1 migration applied and `npm run seed` already run against
 * the same database (see prisma/seed.ts for the seeded users/password).
 */
const { fakeCookieJar } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    fakeCookieJar: {
      get(name: string) {
        return store.has(name) ? { name, value: store.get(name)! } : undefined;
      },
      set(name: string, value: string) {
        store.set(name, value);
      },
      delete(name: string) {
        store.delete(name);
      },
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => fakeCookieJar),
}));

const { prisma } = await import("@/lib/prisma");
const { loginWithPassword } = await import("./login");
const { getCurrentSession, destroySession } = await import("./session");

// Matches prisma/seed.ts exactly — do not change one without the other.
const SEEDED_ADMIN_EMAIL = "admin@acme.chowk.test";
const SEEDED_DEV_PASSWORD = "chowk-dev-password";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("loginWithPassword (real Postgres, no data-layer mocking)", () => {
  it("rejects a seeded user's real row with the wrong password", async () => {
    const result = await loginWithPassword(SEEDED_ADMIN_EMAIL, "not-the-right-password");
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    await expect(getCurrentSession()).resolves.toBeNull();
  });

  it("succeeds against the seeded admin user's real (documented dev) password and establishes the expected session", async () => {
    // Look up the expected org/role directly against the real database so
    // this assertion doesn't hardcode ids that vary between seed runs.
    const seededUser = await prisma.user.findFirst({
      where: { email: SEEDED_ADMIN_EMAIL },
    });
    expect(seededUser).not.toBeNull();
    if (!seededUser) throw new Error("unreachable");

    const result = await loginWithPassword(SEEDED_ADMIN_EMAIL, SEEDED_DEV_PASSWORD);

    expect(result).toEqual({ ok: true });

    // Session was sealed into the (fake) cookie jar and now round-trips
    // back out through the real iron-session unsealing path.
    await expect(getCurrentSession()).resolves.toEqual({
      userId: seededUser.id,
      organizationId: seededUser.organizationId,
      role: seededUser.role,
    });

    await destroySession();
    await expect(getCurrentSession()).resolves.toBeNull();
  });
});
