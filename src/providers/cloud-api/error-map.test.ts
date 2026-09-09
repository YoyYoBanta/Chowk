import { describe, expect, it } from "vitest";
import { mapMetaError } from "./error-map";

/**
 * Pure unit tests, zero network. Two things are being pinned down here:
 *
 * 1. **The error shape actually thrown.** `callMetaAPI()` does `throw data`
 *    with the parsed Graph body, `{ error: { code, message } }`. Until
 *    2026-09-09 the mapper only read the axios shape
 *    (`err.response.data.error.code`) and a bare `err.code`, so nothing ever
 *    matched, every Graph error became `META_ERROR_UNKNOWN`, and every one of
 *    them was classified terminal -- including the rate limits the retryable
 *    bucket exists for. These tests fail against that old implementation.
 *
 * 2. **Retryable-vs-terminal bucketing** for each code confirmed against
 *    Meta's live error-codes page (see TODO-VERIFY.md).
 */
describe("mapMetaError - the shape callMetaAPI actually throws", () => {
  it("reads the code out of a raw Graph body, the shape callMetaAPI throws", () => {
    const result = mapMetaError({
      error: { code: 130429, message: "Cloud API message throughput has been reached." },
    });
    expect(result.retryable).toBe(true);
    expect(result.code).toBe("RATE_LIMIT_OR_TRANSIENT");
  });

  it("still reads the axios-style nested shape, if a caller ever swaps clients", () => {
    const result = mapMetaError({
      response: { data: { error: { code: 190, message: "Your access token has expired." } } },
    });
    expect(result.retryable).toBe(false);
    expect(result.code).toBe("AUTH_FAILED");
  });

  it("carries the Graph message through on an unrecognized code", () => {
    const result = mapMetaError({ error: { code: 999999, message: "Something new." } });
    expect(result.retryable).toBe(false);
    expect(result.code).toBe("META_ERROR_999999");
    expect(result.message).toBe("Something new.");
  });

  it("does not throw on null, undefined, or a non-object", () => {
    for (const input of [null, undefined, "boom", 42]) {
      const result = mapMetaError(input);
      expect(result.retryable).toBe(false);
      expect(result.code).toBe("META_ERROR_UNKNOWN");
    }
  });
});

describe("mapMetaError - retryable classification", () => {
  it.each([
    [4, "application-level rate limit"],
    [80007, "WABA rate limit"],
    [130429, "throughput reached"],
    [131056, "per-recipient pair rate limit"],
  ])("treats %i (%s) as retryable", (code) => {
    expect(mapMetaError({ error: { code } }).retryable).toBe(true);
  });

  /**
   * 131056 is the specific regression this guards. It is a rate limit -- the
   * same request succeeds later -- but it was hitting the terminal catch-all,
   * so sends that only needed a retry were being permanently failed and shown
   * to the agent as undeliverable.
   */
  it("treats 131056 as retryable, not a permanent failure", () => {
    const result = mapMetaError({
      error: { code: 131056, message: "Too many messages sent to this recipient." },
    });
    expect(result.retryable).toBe(true);
    expect(result.code).toBe("RATE_LIMIT_OR_TRANSIENT");
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"])(
    "treats transport failure %s as retryable",
    (code) => {
      expect(mapMetaError({ code }).retryable).toBe(true);
    },
  );
});

describe("mapMetaError - terminal classification", () => {
  it.each([
    [190, "AUTH_FAILED"],
    [131047, "WINDOW_CLOSED"],
    [131026, "INVALID_RECIPIENT"],
    [131051, "UNSUPPORTED_MESSAGE_TYPE"],
    [133010, "NUMBER_NOT_REGISTERED"],
  ])("maps %i to terminal %s", (code, expected) => {
    const result = mapMetaError({ error: { code } });
    expect(result.retryable).toBe(false);
    expect(result.code).toBe(expected);
  });

  it("keeps 131047 terminal — a closed window is not fixed by retrying", () => {
    // Retrying this forever would never succeed; the send has to become a
    // template instead, which is a different request entirely.
    expect(mapMetaError({ error: { code: 131047 } }).retryable).toBe(false);
  });
});
