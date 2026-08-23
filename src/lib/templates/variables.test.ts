import { describe, expect, it } from "vitest";
import { extractTemplateVariableKeys, validateTemplateVariables } from "./variables";

/**
 * context.md §13's named correctness hotspot ("mismatched variable count is
 * caught before the provider call, with a clear error") — this pure helper
 * had no dedicated fast unit test, only indirect coverage through
 * send-message.template.integration.test.ts. Same style as
 * status-progression.test.ts/window.test.ts: the pure logic in isolation,
 * zero DB/network.
 */
describe("extractTemplateVariableKeys", () => {
  it("finds every {{n}} placeholder, de-duplicated, in first-appearance order", () => {
    expect(extractTemplateVariableKeys("Hi {{1}}, your order {{2}} shipped. Thanks {{1}}!")).toEqual(["1", "2"]);
  });

  it("returns an empty array for a body with no placeholders", () => {
    expect(extractTemplateVariableKeys("Thanks for shopping with us!")).toEqual([]);
  });

  it("matches word-character placeholder names, not just digits", () => {
    expect(extractTemplateVariableKeys("Hi {{first_name}}, code {{otp}}.")).toEqual(["first_name", "otp"]);
  });
});

describe("validateTemplateVariables", () => {
  it("passes when every placeholder has a non-empty value", () => {
    const result = validateTemplateVariables("Hi {{1}}, order {{2}} shipped.", { "1": "Asha", "2": "#4821" });
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("fails and names every missing placeholder", () => {
    const result = validateTemplateVariables("Hi {{1}}, order {{2}} shipped.", { "1": "Asha" });
    expect(result).toEqual({ ok: false, missing: ["2"] });
  });

  it("treats a whitespace-only value as missing, not present", () => {
    const result = validateTemplateVariables("Hi {{1}}.", { "1": "   " });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["1"]);
  });

  it("ignores extra keys in variables that the body doesn't use", () => {
    const result = validateTemplateVariables("Hi {{1}}.", { "1": "Asha", "2": "unused" });
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("passes trivially for a body with no placeholders, regardless of variables supplied", () => {
    expect(validateTemplateVariables("No variables here.", {})).toEqual({ ok: true, missing: [] });
  });
});
