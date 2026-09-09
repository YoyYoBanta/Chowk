import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@prisma/client";

/**
 * `src/config/env.ts` validates process.env at import time and the fast suite
 * deliberately supplies no META_* values (vitest.config.ts), so the env module
 * is mocked here rather than the suite's env being widened for one test --
 * META_ACCESS_TOKEN must stay unset everywhere else, and
 * META_GRAPH_API_VERSION is pinned to a non-default value below precisely so
 * the URL assertion proves the version is really being read from config.
 */
vi.mock("@/config/env", () => ({
  env: {
    WHATSAPP_PROVIDER: "cloud-api",
    META_ACCESS_TOKEN: "test-access-token",
    META_GRAPH_API_VERSION: "v99.9",
  },
}));

const { cloudApiAdapter } = await import("./adapter");

const CHANNEL_ID = "chan-upload-test";

function fakeChannel(): Channel {
  // Only the fields the adapter actually touches; the rest of the Prisma row
  // is irrelevant to uploadMedia and asserting on it would be noise.
  return {
    id: CHANNEL_ID,
    organizationId: "org-upload-test",
    metaPhoneNumberId: "1234567890",
  } as Channel;
}

describe("CloudApiProvider.uploadMedia - required multipart fields", () => {
  let capturedUrl: string | undefined;
  let capturedForm: FormData | undefined;

  beforeEach(async () => {
    capturedUrl = undefined;
    capturedForm = undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = String(url);
        capturedForm = init.body as FormData;
        return {
          ok: true,
          json: async () => ({ id: "meta-media-id-123" }),
        } as Response;
      }),
    );

    await cloudApiAdapter.connect(fakeChannel());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await cloudApiAdapter.disconnect(CHANNEL_ID);
  });

  /**
   * Meta documents POST /{phone-number-id}/media as requiring THREE parts:
   * messaging_product, file, and type. `type` was missing until 2026-09-09,
   * which would have failed every real outbound media upload -- invisible to
   * the existing suite because M6's object-storage tests mock the provider.
   */
  it("sends all three required parts: messaging_product, file and type", async () => {
    await cloudApiAdapter.uploadMedia(CHANNEL_ID, Buffer.from("fake-image-bytes"), "image/jpeg");

    expect(capturedForm).toBeDefined();
    const form = capturedForm as FormData;

    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("image/jpeg");
    expect(form.get("file")).toBeInstanceOf(Blob);

    // Guards the actual regression: a missing/blank `type` must fail loudly
    // here rather than at Meta on the first real upload.
    expect(form.has("type")).toBe(true);
    expect(form.get("type")).not.toBe("");
  });

  it("passes the caller's mime type through as `type`, not a hardcoded value", async () => {
    await cloudApiAdapter.uploadMedia(CHANNEL_ID, Buffer.from("%PDF-1.4"), "application/pdf");
    expect((capturedForm as FormData).get("type")).toBe("application/pdf");
  });

  it("builds the upload URL from the configured Graph API version", async () => {
    await cloudApiAdapter.uploadMedia(CHANNEL_ID, Buffer.from("x"), "image/png");
    // v99.9 comes from the mocked env above -- proves the version is read
    // from config rather than hardcoded in the adapter.
    expect(capturedUrl).toBe("https://graph.facebook.com/v99.9/1234567890/media");
  });

  it("returns an internal reference, never Meta's raw media id", async () => {
    const ref = await cloudApiAdapter.uploadMedia(CHANNEL_ID, Buffer.from("abc"), "image/png");
    expect(ref.mimeType).toBe("image/png");
    expect(ref.fileLength).toBe(3);
    expect(ref.id).not.toBe("meta-media-id-123");
  });
});
