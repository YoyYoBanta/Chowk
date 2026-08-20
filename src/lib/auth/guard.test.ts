import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * requireSession/requireRole are the "(dashboard)" route group's enforcement
 * mechanism (used by src/app/(dashboard)/layout.tsx and .../admin-only/page.tsx).
 * Rather than standing up a real Next.js server, this exercises the real
 * `next/navigation` redirect() (it throws a NEXT_REDIRECT error carrying the
 * destination in `error.digest` even outside a request context — see
 * node_modules/next/dist/client/components/redirect.js) against a mocked
 * session layer, so the test proves the actual redirect target without
 * needing a running app.
 */
vi.mock("./session", () => ({
  getCurrentSession: vi.fn(),
}));

const { getCurrentSession } = await import("./session");
const { requireSession, requireRole } = await import("./guard");

function redirectTargetOf(error: unknown): string {
  expect(error).toBeInstanceOf(Error);
  const digest = (error as Error & { digest?: string }).digest;
  expect(digest).toBeDefined();
  expect(digest).toMatch(/^NEXT_REDIRECT;/);
  // Format: NEXT_REDIRECT;<type>;<url>;<statusCode>;
  return digest!.split(";")[2];
}

describe("requireSession", () => {
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockReset();
  });

  it("redirects an unauthenticated request to /login", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    await expect(requireSession()).rejects.toSatisfy((error: unknown) => {
      expect(redirectTargetOf(error)).toBe("/login");
      return true;
    });
  });

  it("returns the session when one exists", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      userId: "user_1",
      organizationId: "org_1",
      role: "AGENT",
    });

    await expect(requireSession()).resolves.toEqual({
      userId: "user_1",
      organizationId: "org_1",
      role: "AGENT",
    });
  });
});

describe("requireRole", () => {
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockReset();
  });

  it("redirects to /login when there is no session at all", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    await expect(requireRole("ADMIN")).rejects.toSatisfy((error: unknown) => {
      expect(redirectTargetOf(error)).toBe("/login");
      return true;
    });
  });

  it("rejects an AGENT session from an ADMIN-only route", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      userId: "user_agent",
      organizationId: "org_1",
      role: "AGENT",
    });

    await expect(requireRole("ADMIN")).rejects.toSatisfy((error: unknown) => {
      // Authenticated but unauthorized — sent to the dashboard home, not
      // back to /login (they ARE logged in, just not an admin).
      expect(redirectTargetOf(error)).toBe("/dashboard");
      return true;
    });
  });

  it("allows an ADMIN session through", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({
      userId: "user_admin",
      organizationId: "org_1",
      role: "ADMIN",
    });

    await expect(requireRole("ADMIN")).resolves.toEqual({
      userId: "user_admin",
      organizationId: "org_1",
      role: "ADMIN",
    });
  });
});
