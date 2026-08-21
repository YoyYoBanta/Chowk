import { describe, expect, it } from "vitest";
import { baileysAdapter } from "./adapter";

/**
 * "Write the failure path first" (context.md rule 6), exercised here
 * against the real Baileys adapter — not the factory-mocked seam used by
 * send-message.consumer.integration.test.ts — against the one failure mode
 * genuinely reachable with no dedicated WhatsApp test number: no live
 * socket for a channel that was never connected. This proves `sendText()`
 * resolves to a well-formed `SendResult` and `markAsRead()` resolves
 * without throwing, rather than crashing the send-message/mark-read
 * consumers, per this milestone's explicit "write the failure path first"
 * verification requirement.
 *
 * Deliberately allowed to live in src/providers/baileys/ and import ./adapter
 * directly — the ESLint provider-boundary rule (eslint.config.mjs) exempts
 * every file inside this directory from the "no reaching into
 * src/providers/baileys/**" restriction; it only applies to files outside it.
 *
 * Fast/no-DB/no-network: `baileysAdapter` is a bare singleton here with an
 * empty internal socket/channel map (nothing has ever called `connect()`
 * in this process), so both methods below hit their early-return "no
 * active session" path before touching Prisma or the network at all.
 */
describe("baileysAdapter — graceful failure with no live socket", () => {
  it("sendText resolves to a well-formed retryable SendResult, never throws", async () => {
    await expect(
      baileysAdapter.sendText({
        channelId: "channel-with-no-live-socket",
        to: "911234567890",
        body: "hello",
      }),
    ).resolves.toEqual({
      ok: false,
      retryable: true,
      code: "NO_ACTIVE_SESSION",
      message: expect.any(String),
    });
  });

  it("markAsRead resolves (does not throw) with no live socket for the channel", async () => {
    await expect(
      baileysAdapter.markAsRead("channel-with-no-live-socket", "some-provider-message-id"),
    ).resolves.toBeUndefined();
  });
});
