import { describe, expect, it } from "vitest";
import { CLOSING_SOON_THRESHOLD_MS, WINDOW_DURATION_MS, getWindowState, isWindowOpen } from "./window";

/**
 * Pure unit tests, zero DB/network — context.md §13's named
 * correctness-bug hotspot for this milestone. Every boundary case the
 * milestone's own brief calls out by name: exactly-24h, just-under,
 * just-over, `lastInboundAt = null`, and the closing-soon (<2h) threshold.
 */
describe("isWindowOpen", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("is false when lastInboundAt is null", () => {
    expect(isWindowOpen(null, now)).toBe(false);
  });

  it("is true just under 24h ago", () => {
    const lastInboundAt = new Date(now.getTime() - (WINDOW_DURATION_MS - 1));
    expect(isWindowOpen(lastInboundAt, now)).toBe(true);
  });

  it("is false at exactly 24h ago — the boundary is exclusive", () => {
    const lastInboundAt = new Date(now.getTime() - WINDOW_DURATION_MS);
    expect(isWindowOpen(lastInboundAt, now)).toBe(false);
  });

  it("is false just over 24h ago", () => {
    const lastInboundAt = new Date(now.getTime() - (WINDOW_DURATION_MS + 1));
    expect(isWindowOpen(lastInboundAt, now)).toBe(false);
  });

  it("is true for an inbound message that just arrived", () => {
    expect(isWindowOpen(now, now)).toBe(true);
  });

  it("defaults `now` to the real current time when omitted", () => {
    const justNow = new Date();
    expect(isWindowOpen(justNow)).toBe(true);
    expect(isWindowOpen(new Date(justNow.getTime() - WINDOW_DURATION_MS - 1_000))).toBe(false);
  });
});

describe("getWindowState", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("lastInboundAt null: closed, no closesAt, no remainingMs, never closing-soon", () => {
    expect(getWindowState(null, now)).toEqual({
      isOpen: false,
      closesAt: null,
      remainingMs: null,
      isClosingSoon: false,
    });
  });

  it("well within the window: open, remainingMs positive and large, not closing soon", () => {
    const lastInboundAt = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1h ago
    const state = getWindowState(lastInboundAt, now);
    expect(state.isOpen).toBe(true);
    expect(state.closesAt).toEqual(new Date(lastInboundAt.getTime() + WINDOW_DURATION_MS));
    expect(state.remainingMs).toBe(23 * 60 * 60 * 1000);
    expect(state.isClosingSoon).toBe(false);
  });

  it("just under the closing-soon threshold (<2h remaining): open and closing soon", () => {
    // 22h1m ago -> 1h59m remaining, just inside the <2h threshold.
    const lastInboundAt = new Date(now.getTime() - (22 * 60 * 60 * 1000 + 60 * 1000));
    const state = getWindowState(lastInboundAt, now);
    expect(state.isOpen).toBe(true);
    expect(state.isClosingSoon).toBe(true);
    expect(state.remainingMs).toBe(CLOSING_SOON_THRESHOLD_MS - 60 * 1000);
  });

  it("exactly 2h remaining: open but NOT yet closing soon — the threshold is exclusive", () => {
    const lastInboundAt = new Date(now.getTime() - (WINDOW_DURATION_MS - CLOSING_SOON_THRESHOLD_MS));
    const state = getWindowState(lastInboundAt, now);
    expect(state.isOpen).toBe(true);
    expect(state.remainingMs).toBe(CLOSING_SOON_THRESHOLD_MS);
    expect(state.isClosingSoon).toBe(false);
  });

  it("exactly 24h ago: closed, remainingMs null, closesAt still reported, not closing-soon", () => {
    const lastInboundAt = new Date(now.getTime() - WINDOW_DURATION_MS);
    const state = getWindowState(lastInboundAt, now);
    expect(state.isOpen).toBe(false);
    expect(state.closesAt).toEqual(new Date(lastInboundAt.getTime() + WINDOW_DURATION_MS));
    expect(state.remainingMs).toBeNull();
    expect(state.isClosingSoon).toBe(false);
  });

  it("well past 24h ago: closed, remainingMs null, closesAt in the past", () => {
    const lastInboundAt = new Date(now.getTime() - (WINDOW_DURATION_MS + 5 * 60 * 60 * 1000));
    const state = getWindowState(lastInboundAt, now);
    expect(state.isOpen).toBe(false);
    expect(state.remainingMs).toBeNull();
    expect(state.closesAt!.getTime()).toBeLessThan(now.getTime());
    expect(state.isClosingSoon).toBe(false);
  });
});
