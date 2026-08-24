import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "./webhook-verify";

/**
 * context.md §13's third named correctness hotspot ("signature
 * verification") had no dedicated test anywhere in this codebase — this
 * closes that gap as part of M9's regression sweep. Pure/no-I/O: builds
 * real HMAC-SHA256 signatures the same way Meta's own
 * `x-hub-signature-256` header is documented to (`sha256=<hex digest>`),
 * never a fake/shortcut signature shape.
 */
const APP_SECRET = "test-app-secret";

function sign(payload: string, secret = APP_SECRET): string {
  const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

describe("verifySignature", () => {
  it("accepts a signature computed with the correct secret over the exact raw payload", () => {
    const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect(verifySignature(payload, sign(payload), APP_SECRET)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const payload = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifySignature(payload, sign(payload, "a-different-secret"), APP_SECRET)).toBe(false);
  });

  it("rejects when the payload has been tampered with after signing", () => {
    const original = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const signature = sign(original);
    const tampered = JSON.stringify({ object: "whatsapp_business_account", entry: ["injected"] });
    expect(verifySignature(tampered, signature, APP_SECRET)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifySignature("{}", null, APP_SECRET)).toBe(false);
  });

  it("rejects a header missing the sha256= prefix", () => {
    const payload = "{}";
    const digest = crypto.createHmac("sha256", APP_SECRET).update(payload).digest("hex");
    expect(verifySignature(payload, digest, APP_SECRET)).toBe(false); // no "sha256=" prefix
    expect(verifySignature(payload, `sha1=${digest}`, APP_SECRET)).toBe(false); // wrong algorithm tag
  });

  it("rejects a malformed/truncated hex signature without throwing", () => {
    expect(() => verifySignature("{}", "sha256=not-valid-hex", APP_SECRET)).not.toThrow();
    expect(verifySignature("{}", "sha256=not-valid-hex", APP_SECRET)).toBe(false);
    // A signature of the wrong byte length would make crypto.timingSafeEqual
    // throw internally — verifySignature must catch that and return false,
    // not let it propagate as an unhandled exception into the route handler.
    expect(verifySignature("{}", "sha256=ab", APP_SECRET)).toBe(false);
  });
});
