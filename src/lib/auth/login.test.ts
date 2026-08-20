import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/data/users", () => ({
  findCandidateUsersByEmailForLogin: vi.fn(),
}));
vi.mock("./password", () => ({
  verifyPassword: vi.fn(),
}));
vi.mock("./session", () => ({
  createSession: vi.fn(),
}));

const { findCandidateUsersByEmailForLogin } = await import("@/data/users");
const { verifyPassword } = await import("./password");
const { createSession } = await import("./session");
const { loginWithPassword } = await import("./login");

describe("loginWithPassword", () => {
  beforeEach(() => {
    vi.mocked(findCandidateUsersByEmailForLogin).mockReset();
    vi.mocked(verifyPassword).mockReset();
    vi.mocked(createSession).mockReset().mockResolvedValue(undefined);
  });

  it("fails with no matching candidate", async () => {
    vi.mocked(findCandidateUsersByEmailForLogin).mockResolvedValue([]);

    const result = await loginWithPassword("nobody@example.test", "whatever");

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("fails when the password doesn't match any candidate", async () => {
    vi.mocked(findCandidateUsersByEmailForLogin).mockResolvedValue([
      {
        id: "user_1",
        organizationId: "org_1",
        email: "a@example.test",
        passwordHash: "hash",
        name: "A",
        role: "AGENT",
        isOnline: false,
        lastSeenAt: null,
        createdAt: new Date(),
      },
    ]);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    const result = await loginWithPassword("a@example.test", "wrong");

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("succeeds and creates a session scoped to the matching candidate's org", async () => {
    vi.mocked(findCandidateUsersByEmailForLogin).mockResolvedValue([
      {
        id: "user_1",
        organizationId: "org_1",
        email: "a@example.test",
        passwordHash: "hash-1",
        name: "A",
        role: "ADMIN",
        isOnline: false,
        lastSeenAt: null,
        createdAt: new Date(),
      },
    ]);
    vi.mocked(verifyPassword).mockResolvedValue(true);

    const result = await loginWithPassword("a@example.test", "correct");

    expect(result).toEqual({ ok: true });
    expect(createSession).toHaveBeenCalledWith({
      userId: "user_1",
      organizationId: "org_1",
      role: "ADMIN",
    });
  });

  it("when the same email exists in two orgs, adopts whichever org's password matches", async () => {
    vi.mocked(findCandidateUsersByEmailForLogin).mockResolvedValue([
      {
        id: "user_org_a",
        organizationId: "org_a",
        email: "shared@example.test",
        passwordHash: "hash-a",
        name: "In Org A",
        role: "AGENT",
        isOnline: false,
        lastSeenAt: null,
        createdAt: new Date(),
      },
      {
        id: "user_org_b",
        organizationId: "org_b",
        email: "shared@example.test",
        passwordHash: "hash-b",
        name: "In Org B",
        role: "ADMIN",
        isOnline: false,
        lastSeenAt: null,
        createdAt: new Date(),
      },
    ]);
    // Only the second candidate's password matches.
    vi.mocked(verifyPassword).mockImplementation(
      async (_password, hash) => hash === "hash-b",
    );

    const result = await loginWithPassword("shared@example.test", "org-b-password");

    expect(result).toEqual({ ok: true });
    expect(createSession).toHaveBeenCalledWith({
      userId: "user_org_b",
      organizationId: "org_b",
      role: "ADMIN",
    });
  });
});
