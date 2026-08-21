import { describe, expect, it } from "vitest";
import { isForwardStatusTransition, statusRank, statusesBelow } from "./status-progression";

/**
 * Pure unit tests, zero DB — this is context.md §13's named
 * correctness-bug hotspot ("status progression"), exercised directly
 * against the ranking function rather than only indirectly through an
 * integration test. See send-message.consumer.integration.test.ts /
 * status-update.consumer.integration.test.ts for the real-Postgres proof
 * that this function is actually wired into the consumer correctly.
 */
describe("statusRank", () => {
  it("orders PENDING < SENT < DELIVERED < READ < FAILED", () => {
    expect(statusRank("PENDING")).toBeLessThan(statusRank("SENT"));
    expect(statusRank("SENT")).toBeLessThan(statusRank("DELIVERED"));
    expect(statusRank("DELIVERED")).toBeLessThan(statusRank("READ"));
    expect(statusRank("READ")).toBeLessThan(statusRank("FAILED"));
  });
});

describe("isForwardStatusTransition", () => {
  it("allows the normal forward progression", () => {
    expect(isForwardStatusTransition("PENDING", "SENT")).toBe(true);
    expect(isForwardStatusTransition("SENT", "DELIVERED")).toBe(true);
    expect(isForwardStatusTransition("DELIVERED", "READ")).toBe(true);
    expect(isForwardStatusTransition("PENDING", "READ")).toBe(true); // skipping ranks forward is still forward
  });

  it("ignores a stale/out-of-order status arriving after a later one — this IS correct, not a bug", () => {
    expect(isForwardStatusTransition("READ", "SENT")).toBe(false);
    expect(isForwardStatusTransition("DELIVERED", "SENT")).toBe(false);
    expect(isForwardStatusTransition("READ", "DELIVERED")).toBe(false);
  });

  it("ignores the exact same status arriving twice (a duplicate/replayed webhook)", () => {
    expect(isForwardStatusTransition("SENT", "SENT")).toBe(false);
    expect(isForwardStatusTransition("READ", "READ")).toBe(false);
  });

  it("allows FAILED from any non-terminal state, including after SENT or READ", () => {
    expect(isForwardStatusTransition("PENDING", "FAILED")).toBe(true);
    expect(isForwardStatusTransition("SENT", "FAILED")).toBe(true);
    expect(isForwardStatusTransition("DELIVERED", "FAILED")).toBe(true);
    expect(isForwardStatusTransition("READ", "FAILED")).toBe(true);
  });

  it("treats FAILED as terminal — nothing moves past it, including another FAILED", () => {
    expect(isForwardStatusTransition("FAILED", "SENT")).toBe(false);
    expect(isForwardStatusTransition("FAILED", "READ")).toBe(false);
    expect(isForwardStatusTransition("FAILED", "FAILED")).toBe(false);
  });
});

describe("statusesBelow", () => {
  it("returns every status ranked below the target", () => {
    expect(statusesBelow("SENT")).toEqual(["PENDING"]);
    expect(new Set(statusesBelow("DELIVERED"))).toEqual(new Set(["PENDING", "SENT"]));
    expect(new Set(statusesBelow("FAILED"))).toEqual(
      new Set(["PENDING", "SENT", "DELIVERED", "READ"]),
    );
  });

  it("returns an empty array for PENDING — nothing legitimately ranks below it", () => {
    expect(statusesBelow("PENDING")).toEqual([]);
  });
});
