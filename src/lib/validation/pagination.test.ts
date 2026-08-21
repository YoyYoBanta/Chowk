import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, paginationQuerySchema } from "./pagination";

describe("pagination", () => {
  it("round-trips a cursor through encode/decode", () => {
    const cursor = encodeCursor({ id: "msg_123", metaTimestamp: "2026-08-21T00:00:00.000Z" });
    expect(typeof cursor).toBe("string");
    const decoded = decodeCursor<{ id: string; metaTimestamp: string }>(cursor);
    expect(decoded).toEqual({ id: "msg_123", metaTimestamp: "2026-08-21T00:00:00.000Z" });
  });

  it("returns null for a malformed cursor instead of throwing", () => {
    expect(decodeCursor("not-valid-base64url-json!!!")).toBeNull();
    expect(decodeCursor(Buffer.from("null").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('"just a string"').toString("base64url"))).toBeNull();
  });

  it("paginationQuerySchema defaults limit to 20 and caps at 100", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(paginationQuerySchema.parse({ limit: "50" })).toEqual({ limit: 50 });
    expect(paginationQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("paginationQuerySchema accepts an opaque cursor string", () => {
    const parsed = paginationQuerySchema.parse({ cursor: "abc123" });
    expect(parsed.cursor).toBe("abc123");
  });
});
