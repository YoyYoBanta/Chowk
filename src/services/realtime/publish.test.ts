import { describe, expect, it } from "vitest";
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
    expect(realtimeChannelForOrg("org_a")).toBe("chowk:realtime:org:org_a");
    expect(realtimeChannelForOrg("org_b")).toBe("chowk:realtime:org:org_b");
    expect(realtimeChannelForOrg("org_a")).not.toBe(realtimeChannelForOrg("org_b"));
  });
});
