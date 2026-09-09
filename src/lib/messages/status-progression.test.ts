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
  it("orders PENDING < SENT < FAILED < DELIVERED < READ", () => {
    expect(statusRank("PENDING")).toBeLessThan(statusRank("SENT"));
    expect(statusRank("SENT")).toBeLessThan(statusRank("FAILED"));
    expect(statusRank("FAILED")).toBeLessThan(statusRank("DELIVERED"));
    expect(statusRank("DELIVERED")).toBeLessThan(statusRank("READ"));
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

  it("allows FAILED from PENDING or SENT — a send that never got further", () => {
    expect(isForwardStatusTransition("PENDING", "FAILED")).toBe(true);
    expect(isForwardStatusTransition("SENT", "FAILED")).toBe(true);
  });

  /**
   * The 2026-09-09 rule change. Meta emits BOTH `delivered` and `failed` for
   * one message when the recipient is on several devices and delivery
   * succeeds on one but not another. Delivery is a positive fact: a later
   * failure on some other device must not retract it, or the agent sees a
   * message the recipient definitely received reported as failed.
   */
  it("ignores a FAILED arriving after DELIVERED or READ — delivery is not retracted", () => {
    expect(isForwardStatusTransition("DELIVERED", "FAILED")).toBe(false);
    expect(isForwardStatusTransition("READ", "FAILED")).toBe(false);
  });

  it("lets DELIVERED/READ upgrade a FAILED — the same multi-device race, webhooks reversed", () => {
    // Meta does not guarantee webhook ordering, so the failed-then-delivered
    // ordering must converge on the same final state as delivered-then-failed.
    expect(isForwardStatusTransition("FAILED", "DELIVERED")).toBe(true);
    expect(isForwardStatusTransition("FAILED", "READ")).toBe(true);
  });

  it("both multi-device webhook orderings converge on DELIVERED", () => {
    const apply = (current: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED", next: typeof current) =>
      isForwardStatusTransition(current, next) ? next : current;

    // delivered then failed
    expect(apply(apply("SENT", "DELIVERED"), "FAILED")).toBe("DELIVERED");
    // failed then delivered
    expect(apply(apply("SENT", "FAILED"), "DELIVERED")).toBe("DELIVERED");
  });

  it("still refuses to let a stale or replayed SENT overwrite a real FAILED", () => {
    expect(isForwardStatusTransition("FAILED", "SENT")).toBe(false);
    expect(isForwardStatusTransition("FAILED", "PENDING")).toBe(false);
    expect(isForwardStatusTransition("FAILED", "FAILED")).toBe(false);
  });
});

describe("statusesBelow", () => {
  it("returns every status ranked below the target", () => {
    expect(statusesBelow("SENT")).toEqual(["PENDING"]);
    // FAILED is now reachable only from PENDING/SENT, so it is these two that
    // the atomic `WHERE status IN (...)` update is allowed to overwrite.
    expect(new Set(statusesBelow("FAILED"))).toEqual(new Set(["PENDING", "SENT"]));
    expect(new Set(statusesBelow("DELIVERED"))).toEqual(new Set(["PENDING", "SENT", "FAILED"]));
    expect(new Set(statusesBelow("READ"))).toEqual(
      new Set(["PENDING", "SENT", "FAILED", "DELIVERED"]),
    );
  });

  it("returns an empty array for PENDING — nothing legitimately ranks below it", () => {
    expect(statusesBelow("PENDING")).toEqual([]);
  });
});
