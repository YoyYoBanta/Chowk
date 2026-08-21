import { describe, expect, it } from "vitest";
import { WAMessageStatus, type WAMessage, type WAMessageUpdate } from "@whiskeysockets/baileys";
import {
  baileysMediaTypeFromMime,
  digitsToJid,
  jidToDigits,
  normalizeBaileysMessage,
  normalizeBaileysStatusUpdate,
} from "./normalize";

/**
 * Pure unit tests for the Baileys -> NormalizedInboundEvent mapping — no
 * DB, no Redis, no live socket. Real `@whiskeysockets/baileys` types are
 * used for the fake WAMessage fixtures below (constructed by hand, not
 * captured from a live session — see TODO-VERIFY.md's M2 section for why
 * that's the ceiling of what's verifiable without a dedicated test
 * number), so this at least proves the mapping logic itself is exercised
 * against the real shape the package's own types describe.
 */

function fakeMessage(overrides: Partial<WAMessage>): WAMessage {
  return {
    key: { remoteJid: "911234567890@s.whatsapp.net", fromMe: false, id: "FAKE_ID_1" },
    messageTimestamp: 1_700_000_000,
    pushName: "Test Contact",
    ...overrides,
  } as WAMessage;
}

describe("jidToDigits", () => {
  it("strips the @s.whatsapp.net suffix", () => {
    expect(jidToDigits("911234567890@s.whatsapp.net")).toBe("911234567890");
  });

  it("strips a multi-device :NN suffix before the @", () => {
    expect(jidToDigits("911234567890:12@s.whatsapp.net")).toBe("911234567890");
  });

  it("strips any non-digit characters", () => {
    expect(jidToDigits("+91-1234-567890@s.whatsapp.net")).toBe("911234567890");
  });
});

describe("digitsToJid", () => {
  it("is the inverse of jidToDigits for the individual-chat case", () => {
    expect(digitsToJid("911234567890")).toBe("911234567890@s.whatsapp.net");
    expect(jidToDigits(digitsToJid("911234567890"))).toBe("911234567890");
  });
});

describe("normalizeBaileysMessage", () => {
  it("returns null for our own outbound echo (fromMe)", () => {
    const msg = fakeMessage({ key: { remoteJid: "x@s.whatsapp.net", fromMe: true, id: "1" } });
    expect(normalizeBaileysMessage("channel-1", msg)).toBeNull();
  });

  it("returns null when there is no usable key id or remoteJid", () => {
    const msg = fakeMessage({ key: { remoteJid: undefined, fromMe: false, id: undefined } });
    expect(normalizeBaileysMessage("channel-1", msg)).toBeNull();
  });

  it("maps a plain-text conversation message to TEXT", () => {
    const msg = fakeMessage({ message: { conversation: "hello there" } });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      channelId: "channel-1",
      providerMessageId: "FAKE_ID_1",
      from: "911234567890",
      contactName: "Test Contact",
      type: "TEXT",
      body: "hello there",
      media: null,
      interactive: null,
    });
    expect(event?.timestamp).toEqual(new Date(1_700_000_000 * 1000));
    expect(event?.raw).toBe(msg);
  });

  it("maps an extendedTextMessage to TEXT", () => {
    const msg = fakeMessage({ message: { extendedTextMessage: { text: "extended hi" } } });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event).toMatchObject({ type: "TEXT", body: "extended hi" });
  });

  it("maps an imageMessage to IMAGE with a media reference and caption as body", () => {
    const msg = fakeMessage({
      message: {
        imageMessage: {
          caption: "a photo",
          mimetype: "image/jpeg",
          directPath: "/some/path",
          fileLength: 1234,
        },
      },
    });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event?.type).toBe("IMAGE");
    expect(event?.body).toBe("a photo");
    expect(event?.media).toMatchObject({
      id: "/some/path",
      mimeType: "image/jpeg",
      fileLength: 1234,
    });
  });

  it("maps a buttonsResponseMessage to INTERACTIVE with a button_reply payload", () => {
    const msg = fakeMessage({
      message: {
        buttonsResponseMessage: { selectedButtonId: "btn-1", selectedDisplayText: "Yes" },
      },
    });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event?.type).toBe("INTERACTIVE");
    expect(event?.interactive).toEqual({ kind: "button_reply", id: "btn-1", title: "Yes" });
  });

  it("falls back to UNSUPPORTED for a recognized-but-unmapped content type, preserving raw", () => {
    // pollCreationMessage is a real Baileys/WhatsApp message type our
    // MessageType enum has no slot for (architecture.md §6: "UNSUPPORTED
    // fallback ... store raw preserved and continue. Never throw").
    const msg = fakeMessage({
      message: { pollCreationMessage: { name: "Pick one", options: [{ optionName: "A" }] } },
    });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event).not.toBeNull();
    expect(event?.type).toBe("UNSUPPORTED");
    expect(event?.body).toBeNull();
    expect(event?.raw).toBe(msg);
  });

  it("falls back to UNSUPPORTED when there is no message content at all", () => {
    const msg = fakeMessage({ message: undefined });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event?.type).toBe("UNSUPPORTED");
  });

  /**
   * M6: mediaRefFrom must capture mediaKey/directPath/url — without
   * mediaKey specifically, src/providers/baileys/adapter.ts's
   * downloadMedia() cannot decrypt anything at all (Baileys media is
   * end-to-end encrypted). This is the actual regression this milestone's
   * inbound pipeline depends on.
   */
  it("captures mediaKey/directPath/url on an imageMessage's media reference (needed to decrypt it later)", () => {
    const mediaKeyBytes = new Uint8Array([1, 2, 3, 4]);
    const msg = fakeMessage({
      message: {
        imageMessage: {
          mimetype: "image/jpeg",
          directPath: "/v/abc123",
          url: "https://mmg.whatsapp.net/abc123",
          mediaKey: mediaKeyBytes,
          fileLength: 999,
        },
      },
    });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event?.media).toMatchObject({
      directPath: "/v/abc123",
      url: "https://mmg.whatsapp.net/abc123",
      mediaKey: Buffer.from(mediaKeyBytes).toString("base64"),
    });
  });

  it("maps a locationMessage to LOCATION with 'lat,lng' captured as body", () => {
    const msg = fakeMessage({
      message: { locationMessage: { degreesLatitude: 12.9716, degreesLongitude: 77.5946 } },
    });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event?.type).toBe("LOCATION");
    expect(event?.body).toBe("12.9716,77.5946");
  });

  it("maps a locationMessage with no coordinates to LOCATION with a null body", () => {
    const msg = fakeMessage({ message: { locationMessage: {} } });
    const event = normalizeBaileysMessage("channel-1", msg);
    expect(event?.type).toBe("LOCATION");
    expect(event?.body).toBeNull();
  });
});

describe("baileysMediaTypeFromMime", () => {
  it("maps common MIME prefixes to Baileys' MediaType strings", () => {
    expect(baileysMediaTypeFromMime("image/jpeg")).toBe("image");
    expect(baileysMediaTypeFromMime("image/webp")).toBe("image"); // stickers too — see the function's own doc comment
    expect(baileysMediaTypeFromMime("video/mp4")).toBe("video");
    expect(baileysMediaTypeFromMime("audio/ogg")).toBe("audio");
  });

  it("falls back to 'document' for anything else", () => {
    expect(baileysMediaTypeFromMime("application/pdf")).toBe("document");
    expect(baileysMediaTypeFromMime("application/octet-stream")).toBe("document");
  });
});

/**
 * `normalizeBaileysStatusUpdate` tests: real `WAMessageStatus` enum values
 * (from the package's own `.d.ts`, see normalize.ts's doc comment) are used
 * to build fixtures, so this exercises the actual mapping the real
 * `messages.update` event would produce, same spirit as the tests above.
 */
function fakeStatusUpdate(overrides: Partial<WAMessageUpdate>): WAMessageUpdate {
  return {
    key: { remoteJid: "911234567890@s.whatsapp.net", fromMe: true, id: "WAMID_1" },
    update: {},
    ...overrides,
  } as WAMessageUpdate;
}

describe("normalizeBaileysStatusUpdate", () => {
  it("maps SERVER_ACK to SENT", () => {
    const update = fakeStatusUpdate({ update: { status: WAMessageStatus.SERVER_ACK } });
    const event = normalizeBaileysStatusUpdate("channel-1", update);
    expect(event).toMatchObject({ channelId: "channel-1", providerMessageId: "WAMID_1", status: "SENT" });
  });

  it("maps DELIVERY_ACK to DELIVERED", () => {
    const update = fakeStatusUpdate({ update: { status: WAMessageStatus.DELIVERY_ACK } });
    expect(normalizeBaileysStatusUpdate("channel-1", update)?.status).toBe("DELIVERED");
  });

  it("maps READ to READ", () => {
    const update = fakeStatusUpdate({ update: { status: WAMessageStatus.READ } });
    expect(normalizeBaileysStatusUpdate("channel-1", update)?.status).toBe("READ");
  });

  it("maps PLAYED (voice-note ack) to READ", () => {
    const update = fakeStatusUpdate({ update: { status: WAMessageStatus.PLAYED } });
    expect(normalizeBaileysStatusUpdate("channel-1", update)?.status).toBe("READ");
  });

  it("maps ERROR to FAILED with a generic, honest error code/message — never inventing a specific one", () => {
    const update = fakeStatusUpdate({ update: { status: WAMessageStatus.ERROR } });
    const event = normalizeBaileysStatusUpdate("channel-1", update);
    expect(event?.status).toBe("FAILED");
    expect(event?.errorCode).toBe("BAILEYS_SEND_ERROR");
    expect(event?.errorMessage).toEqual(expect.any(String));
  });

  it("returns null for PENDING (no information beyond what we already know)", () => {
    const update = fakeStatusUpdate({ update: { status: WAMessageStatus.PENDING } });
    expect(normalizeBaileysStatusUpdate("channel-1", update)).toBeNull();
  });

  it("returns null when the update carries no ack-status change at all", () => {
    const update = fakeStatusUpdate({ update: { starred: true } });
    expect(normalizeBaileysStatusUpdate("channel-1", update)).toBeNull();
  });

  it("returns null when the key has no usable message id", () => {
    const update = fakeStatusUpdate({
      key: { remoteJid: "911234567890@s.whatsapp.net", fromMe: true, id: undefined },
      update: { status: WAMessageStatus.READ },
    });
    expect(normalizeBaileysStatusUpdate("channel-1", update)).toBeNull();
  });
});
