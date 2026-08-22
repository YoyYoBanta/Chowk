import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The milestone's real acceptance test (context.md §11, M2 note /
 * architecture.md §5): "a stub cloud-api provider implementing the same
 * interface compiles and is selectable by env var without touching any
 * code outside src/providers/." This proves the selectable-by-env-var half
 * for real — no test-only branching, the exact same `getWhatsAppProvider()`
 * used by the rest of the app.
 *
 * `vi.resetModules()` + a dynamic `import()` per test is required because
 * src/config/env.ts parses `process.env` once at module load and
 * src/providers/factory.ts caches its resolved singleton at module scope —
 * without resetting the module registry, the second test would just see
 * the first test's cached provider.
 */
describe("getWhatsAppProvider (provider selection by WHATSAPP_PROVIDER)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it(
    "selects the baileys adapter when WHATSAPP_PROVIDER=baileys (vitest.config.ts's default)",
    async () => {
      // Generous timeout: this is the first test in the file to import
      // ./factory, which transitively pulls in the real
      // @whiskeysockets/baileys package tree — a one-time transform cost
      // (~5-6s), not a sign of anything actually touching the network (see
      // src/queue/connection.ts's doc comment: the Redis connection this
      // also transitively constructs is lazy and does zero I/O on import).
      const { getWhatsAppProvider } = await import("./factory");
      expect(getWhatsAppProvider().name).toBe("baileys");
    },
    15_000,
  );

  it("selects the cloud-api adapter when WHATSAPP_PROVIDER=cloud-api", async () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "cloud-api");
    vi.resetModules();

    const { getWhatsAppProvider } = await import("./factory");
    const provider = getWhatsAppProvider();

    expect(provider.name).toBe("cloud-api");

    // No longer a pure "not implemented" stub as of M10's real Cloud API
    // adapter — the interface still genuinely resolves cleanly (not a type
    // error, not a thrown exception) for a channel that was never
    // connect()-ed, which is the actual thing this test proves: the
    // interface holds regardless of which provider is selected.
    const sendResult = await provider.sendText({
      channelId: "chan-1",
      to: "911234567890",
      body: "hello",
    });
    expect(sendResult).toEqual({
      ok: false,
      retryable: true,
      code: "NOT_CONFIGURED",
      message: expect.any(String),
    });

    await expect(provider.getConnectionState("chan-1")).resolves.toMatchObject({
      status: "disconnected",
    });
    await expect(provider.listTemplates("chan-1")).resolves.toEqual([]);
  });

  it("returns the same cached instance across repeated calls within one module load", async () => {
    const { getWhatsAppProvider } = await import("./factory");
    const first = getWhatsAppProvider();
    const second = getWhatsAppProvider();
    expect(first).toBe(second);
  });
});
