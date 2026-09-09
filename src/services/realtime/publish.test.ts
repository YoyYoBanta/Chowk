import { describe, expect, it } from "vitest";
import { REDIS_KEY_PREFIX } from "@/queue/connection";
import { realtimeChannelForOrg } from "./publish";

/**
 * Fast unit test for the one pure piece of this module — channel naming.
 * `publishMessageCreated`/`subscribeToOrgEvents` themselves need a real
 * Redis (see src/worker/realtime-sse.integration.test.ts for the real,
 * end-to-end proof) and are deliberately not exercised here — this file
 * must stay zero-DB/zero-Redis per vitest.config.ts.
 */
describe("realtimeChannelForOrg", () => {
  it("is keyed by organizationId, not a shared fan-out channel", () => {
    expect(realtimeChannelForOrg("org_a")).toBe(`${REDIS_KEY_PREFIX}:chowk:realtime:org:org_a`);
    expect(realtimeChannelForOrg("org_b")).toBe(`${REDIS_KEY_PREFIX}:chowk:realtime:org:org_b`);
    expect(realtimeChannelForOrg("org_a")).not.toBe(realtimeChannelForOrg("org_b"));
  });

  /**
   * Pub/sub channels are namespaced by the same REDIS_KEY_PREFIX as the
   * BullMQ queues, so that one value accounts for every key this app writes
   * to a shared Redis. Asserted against a literal rather than only against
   * the constant: interpolating the constant on both sides of the expectation
   * above would still pass if the prefix silently vanished from the channel
   * name, since both sides would change together.
   */
  it("is namespaced under the configured Redis key prefix", () => {
    const channel = realtimeChannelForOrg("org_a");
    expect(channel.startsWith(`${REDIS_KEY_PREFIX}:`)).toBe(true);
    // vitest.config.ts sets no REDIS_KEY_PREFIX, so the schema default applies.
    expect(channel).toBe("bull:chowk:realtime:org:org_a");
  });
});
