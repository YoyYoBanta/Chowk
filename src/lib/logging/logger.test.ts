import { describe, expect, it, vi, afterEach } from "vitest";
import { logger, newCorrelationId, type LogFields } from "./logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a single JSON line on stdout via console.log for info/debug", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("hello", { organizationId: "org_1", correlationId: "corr_1", count: 3 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "info",
      message: "hello",
      organizationId: "org_1",
      correlationId: "corr_1",
      count: 3,
    });
    expect(typeof line.timestamp).toBe("string");
    // Round-trips as a real ISO timestamp.
    expect(new Date(line.timestamp).toISOString()).toBe(line.timestamp);
  });

  it("routes warn/error to console.error, not console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logger.warn("careful");
    logger.error("boom", { errorMessage: "went wrong" });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    const [warnLine, errorLine] = errorSpy.mock.calls.map(
      (call) => JSON.parse(call[0] as string) as Record<string, unknown>,
    );
    expect(warnLine).toMatchObject({ level: "warn", message: "careful" });
    expect(errorLine).toMatchObject({ level: "error", message: "boom", errorMessage: "went wrong" });
  });

  it("works with no fields at all", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logger.info("no fields here");
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.message).toBe("no fields here");
  });

  it("newCorrelationId returns unique, UUID-shaped strings", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(a).toMatch(uuidPattern);
    expect(b).toMatch(uuidPattern);
    expect(a).not.toBe(b);
  });

  it("LogFields has no field for message content — passing `body` is a type error", () => {
    // This is the "awkward to accidentally leak Message.body" guarantee
    // (context.md §12) proven at compile time: LogFields is a closed
    // interface with no `body`/`content`/`text` property, so TypeScript's
    // excess-property check rejects this object literal. If a future edit
    // widens LogFields to include such a field (or to an index signature),
    // `tsc --noEmit` starts failing here with "Unused '@ts-expect-error'
    // directive" — that failure IS the point of this test.
    const fields: LogFields = {
      organizationId: "org_1",
      // @ts-expect-error -- body/content must never be a loggable field.
      body: "secret customer message content",
    };
    expect(fields.organizationId).toBe("org_1");
  });
});
