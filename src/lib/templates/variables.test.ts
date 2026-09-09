import { describe, expect, it } from "vitest";
import {
  extractTemplateVariableKeys,
  substituteTemplateVariables,
  validateTemplateVariables,
} from "./variables";

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

describe("substituteTemplateVariables", () => {
  it("substitutes every placeholder, including one repeated in the body", () => {
    expect(
      substituteTemplateVariables("Hi {{1}}, order {{2}} shipped. Thanks {{1}}!", { "1": "Asha", "2": "#4821" }),
    ).toBe("Hi Asha, order #4821 shipped. Thanks Asha!");
  });

  /**
   * The bug this helper was extracted to fix. The old send-path
   * implementation in src/providers/baileys/adapter.ts ran one
   * split/join per supplied key, so the pass for {{2}} re-scanned the text
   * already substituted in for {{1}} and replaced the {{2}} *inside the
   * agent's own typed value* -- the recipient saw "see X X" where the agent
   * had previewed "see {{2}} X". Agent input is data, not a template to
   * expand again.
   */
  it("does not re-substitute a {{n}} that appears inside a substituted value", () => {
    expect(substituteTemplateVariables("{{1}} {{2}}", { "1": "see {{2}}", "2": "X" })).toBe("see {{2}} X");
  });

  it("is unaffected by the order the variables are supplied in", () => {
    const body = "{{1}} {{2}}";
    const forward = substituteTemplateVariables(body, { "1": "see {{2}}", "2": "X" });
    const reversed = substituteTemplateVariables(body, { "2": "X", "1": "see {{2}}" });
    expect(forward).toBe(reversed);
  });

  it("leaves a placeholder with no supplied value as the literal {{n}}", () => {
    expect(substituteTemplateVariables("Hi {{1}}, code {{2}}.", { "1": "Asha" })).toBe("Hi Asha, code {{2}}.");
  });

  it("leaves a placeholder whose value is an empty string as the literal {{n}}", () => {
    expect(substituteTemplateVariables("Hi {{1}}.", { "1": "" })).toBe("Hi {{1}}.");
  });

  it("ignores extra keys the body never references", () => {
    expect(substituteTemplateVariables("Hi {{1}}.", { "1": "Asha", "2": "unused" })).toBe("Hi Asha.");
  });

  it("returns a body with no placeholders unchanged", () => {
    expect(substituteTemplateVariables("Thanks for shopping with us!", { "1": "Asha" })).toBe(
      "Thanks for shopping with us!",
    );
  });

  it("treats a value containing $& literally, not as a regex replacement pattern", () => {
    // String.replace expands $&/$1 in a *string* replacement; the callback
    // form this helper uses does not. Agent-typed "$&" must arrive verbatim.
    expect(substituteTemplateVariables("Total: {{1}}", { "1": "$& $1 50%" })).toBe("Total: $& $1 50%");
  });
});
