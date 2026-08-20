import { describe, expect, it } from "vitest";
import type { WAMessage } from "@whiskeysockets/baileys";
import { jidToDigits, normalizeBaileysMessage } from "./normalize";

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
});
