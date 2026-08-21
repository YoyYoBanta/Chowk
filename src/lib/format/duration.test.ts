import { describe, expect, it } from "vitest";
import { formatDurationShort } from "./duration";

describe("formatDurationShort", () => {
  it("formats hours and minutes together", () => {
    expect(formatDurationShort(3 * 60 * 60 * 1000 + 20 * 60 * 1000)).toBe("3h 20m");
  });

  it("omits minutes when exactly on the hour", () => {
    expect(formatDurationShort(2 * 60 * 60 * 1000)).toBe("2h");
  });

  it("omits hours when under one hour", () => {
    expect(formatDurationShort(45 * 60 * 1000)).toBe("45m");
  });

  it("reports 'less than a minute' for very small durations", () => {
    expect(formatDurationShort(10_000)).toBe("less than a minute");
  });

  it("never goes negative for a zero/negative input", () => {
    expect(formatDurationShort(0)).toBe("less than a minute");
    expect(formatDurationShort(-5000)).toBe("less than a minute");
  });
});
