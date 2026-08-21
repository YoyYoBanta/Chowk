import { describe, expect, it } from "vitest";
import {
  ALL_SUPPORTED_MIME_TYPES,
  MEDIA_LIMITS,
  mediaKindForMime,
  messageTypeForMediaKind,
  validateOutboundMedia,
} from "./limits";

/**
 * Pure, zero-DB tests for the file-size/type gate context.md §8.3 requires
 * BEFORE any upload happens — the numbers themselves were fetched live
 * from developers.facebook.com (see this file's own doc comment and
 * TODO-VERIFY.md's M6 section), not guessed, but the LOGIC around them
 * (kind lookup, boundary comparison, error messages) is what's under test
 * here.
 */
describe("mediaKindForMime", () => {
  it("maps a known MIME type to its kind", () => {
    expect(mediaKindForMime("image/jpeg")).toBe("image");
    expect(mediaKindForMime("video/mp4")).toBe("video");
    expect(mediaKindForMime("audio/ogg")).toBe("audio");
    expect(mediaKindForMime("application/pdf")).toBe("document");
  });

  it("returns null for an unrecognized MIME type", () => {
    expect(mediaKindForMime("application/x-msdownload")).toBeNull();
    expect(mediaKindForMime("")).toBeNull();
  });
});

describe("messageTypeForMediaKind", () => {
  it("maps every kind to its MessageType", () => {
    expect(messageTypeForMediaKind("image")).toBe("IMAGE");
    expect(messageTypeForMediaKind("video")).toBe("VIDEO");
    expect(messageTypeForMediaKind("audio")).toBe("AUDIO");
    expect(messageTypeForMediaKind("document")).toBe("DOCUMENT");
  });
});

describe("validateOutboundMedia", () => {
  it("accepts a file within its kind's size limit", () => {
    expect(validateOutboundMedia("image/jpeg", 1024)).toEqual({ ok: true });
  });

  it("accepts a file exactly at the boundary", () => {
    const result = validateOutboundMedia("image/jpeg", MEDIA_LIMITS.image.maxBytes);
    expect(result.ok).toBe(true);
  });

  it("rejects a file one byte over its kind's limit", () => {
    const result = validateOutboundMedia("image/jpeg", MEDIA_LIMITS.image.maxBytes + 1);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it("rejects an unsupported MIME type regardless of size", () => {
    const result = validateOutboundMedia("application/x-msdownload", 10);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported/i);
  });

  it("document's higher 100MB ceiling is independent of image's 5MB one", () => {
    const justUnderImageLimit = MEDIA_LIMITS.image.maxBytes - 1;
    expect(validateOutboundMedia("application/pdf", justUnderImageLimit)).toEqual({ ok: true });
    expect(validateOutboundMedia("application/pdf", MEDIA_LIMITS.document.maxBytes + 1).ok).toBe(false);
  });
});

describe("ALL_SUPPORTED_MIME_TYPES", () => {
  it("flattens every kind's mime types with no duplicates missing", () => {
    for (const limit of Object.values(MEDIA_LIMITS)) {
      for (const mime of limit.mimeTypes) {
        expect(ALL_SUPPORTED_MIME_TYPES).toContain(mime);
      }
    }
  });
});
