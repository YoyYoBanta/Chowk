import { describe, expect, it, vi, beforeEach } from "vitest";

const fakeCookieStore = { get: vi.fn(), set: vi.fn() };

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(fakeCookieStore),
}));

const ironSessionState: Record<string, unknown> = {};
const save = vi.fn().mockResolvedValue(undefined);
const destroy = vi.fn();

vi.mock("iron-session", () => ({
  getIronSession: vi.fn().mockImplementation(() =>
    Promise.resolve(
      Object.assign(ironSessionState, { save, destroy }),
    ),
  ),
}));

const { createSession, destroySession, getCurrentSession } = await import(
  "./session"
);

describe("session", () => {
  beforeEach(() => {
    for (const key of Object.keys(ironSessionState)) {
      delete ironSessionState[key];
    }
    save.mockClear();
    destroy.mockClear();
  });

  it("getCurrentSession returns null when the cookie carries no session data", async () => {
    await expect(getCurrentSession()).resolves.toBeNull();
  });

  it("createSession writes userId/organizationId/role and saves", async () => {
    await createSession({
      userId: "user_1",
      organizationId: "org_1",
      role: "ADMIN",
    });

    expect(save).toHaveBeenCalledTimes(1);
    await expect(getCurrentSession()).resolves.toEqual({
      userId: "user_1",
      organizationId: "org_1",
      role: "ADMIN",
    });
  });

  it("destroySession clears the cookie", async () => {
    await createSession({
      userId: "user_1",
      organizationId: "org_1",
      role: "AGENT",
    });

    await destroySession();

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
