import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");

  it("returns an empty string for null", () => {
    expect(formatRelativeTime(null, now)).toBe("");
  });

  it("formats seconds/minutes/hours/days", () => {
    expect(formatRelativeTime(new Date(now.getTime() - 2_000), now)).toBe("just now");
    expect(formatRelativeTime(new Date(now.getTime() - 30_000), now)).toBe("30s ago");
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m ago");
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3h ago");
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 86_400_000), now)).toBe("2d ago");
  });

  it("falls back to a locale date string beyond a week", () => {
    const eightDaysAgo = new Date(now.getTime() - 8 * 86_400_000);
    expect(formatRelativeTime(eightDaysAgo, now)).toBe(eightDaysAgo.toLocaleDateString());
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(formatRelativeTime(now.toISOString(), now)).toBe("just now");
  });
});
