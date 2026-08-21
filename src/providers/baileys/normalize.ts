import {
  getContentType,
  toNumber,
  WAMessageStatus,
  type WAMessage,
  type WAMessageUpdate,
} from "@whiskeysockets/baileys";
import type {
  InteractivePayload,
  MediaReference,
  MessageType,
  NormalizedInboundEvent,
  NormalizedStatusEvent,
} from "../types";

/**
 * Pure Baileys -> NormalizedInboundEvent mapping, deliberately kept in its
 * own module with no queue/DB imports so it can be unit-tested with zero
 * network dependency (see normalize.test.ts) — adapter.ts's job is wiring
 * this up to a live socket and the real queue, which can't be exercised
 * without a real WhatsApp session (see TODO-VERIFY.md's M2 section).
 *
 * Modelled on Meta's semantics, not Baileys' (context.md §8.0.2): the
 * `MessageType` values below are our enum, and any Baileys content type we
 * don't recognize falls through to `UNSUPPORTED` with the original message
 * preserved as `raw` — never thrown (architecture.md §6).
 */

/** digits-only, no '+', no '@s.whatsapp.net'/'@lid'/device-id suffix — per
 * NormalizedInboundEvent.from's contract. */
export function jidToDigits(jid: string): string {
  return jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
}

/** The inverse of jidToDigits — builds the standard individual-chat JID
 * `sock.sendMessage()`/`sock.readMessages()` expect (verified against the
 * real `messages-send.d.ts`/`chats.d.ts` signatures, see adapter.ts's doc
 * comment). WhatsApp Groups (`@g.us`) are out of scope for Tier 1
 * (context.md §2.2), so this always produces an individual-chat jid. */
export function digitsToJid(digits: string): string {
  return `${digits}@s.whatsapp.net`;
}

interface BaileysMediaContent {
  mimetype?: string | null;
  fileSha256?: Uint8Array | null;
  fileLength?: number | Long | null;
  fileName?: string | null;
  directPath?: string | null;
  url?: string | null;
}

export function mediaRefFrom(
  content: BaileysMediaContent | null | undefined,
  fallbackMime: string,
): MediaReference | null {
  if (!content) return null;
  return {
    id: content.directPath ?? content.url ?? "unknown",
    mimeType: content.mimetype ?? fallbackMime,
    sha256: content.fileSha256 ? Buffer.from(content.fileSha256).toString("base64") : undefined,
    fileLength: content.fileLength != null ? toNumber(content.fileLength) : undefined,
    filename: content.fileName ?? null,
  };
}

/**
 * Maps a real Baileys `WAMessage` onto our transport-agnostic
 * `NormalizedInboundEvent`. Returns null for messages that shouldn't
 * become an inbound event at all (our own outbound echo, or one with no
 * usable key/content — e.g. protocol/system messages).
 */
export function normalizeBaileysMessage(
  channelId: string,
  msg: WAMessage,
): NormalizedInboundEvent | null {
  if (msg.key.fromMe) return null;
  if (!msg.key.id || !msg.key.remoteJid) return null;

  const content = msg.message;
  const contentType = getContentType(content ?? undefined);

  const timestampSeconds = msg.messageTimestamp != null ? toNumber(msg.messageTimestamp) : 0;
  const timestamp = timestampSeconds > 0 ? new Date(timestampSeconds * 1000) : new Date();

  let type: MessageType = "UNSUPPORTED";
  let body: string | null = null;
  let media: MediaReference | null = null;
  let interactive: InteractivePayload | null = null;

  switch (contentType) {
    case "conversation":
      type = "TEXT";
      body = content?.conversation ?? null;
      break;
    case "extendedTextMessage":
      type = "TEXT";
      body = content?.extendedTextMessage?.text ?? null;
      break;
    case "imageMessage":
      type = "IMAGE";
      body = content?.imageMessage?.caption ?? null;
      media = mediaRefFrom(content?.imageMessage, "image/jpeg");
      break;
    case "videoMessage":
      type = "VIDEO";
      body = content?.videoMessage?.caption ?? null;
      media = mediaRefFrom(content?.videoMessage, "video/mp4");
      break;
    case "audioMessage":
      type = "AUDIO";
      media = mediaRefFrom(content?.audioMessage, "audio/ogg");
      break;
    case "documentMessage":
      type = "DOCUMENT";
      body = content?.documentMessage?.caption ?? null;
      media = mediaRefFrom(content?.documentMessage, "application/octet-stream");
      break;
    case "stickerMessage":
      type = "STICKER";
      media = mediaRefFrom(content?.stickerMessage, "image/webp");
      break;
    case "locationMessage":
      type = "LOCATION";
      break;
    case "contactMessage":
    case "contactsArrayMessage":
      type = "CONTACTS";
      break;
    case "buttonsResponseMessage":
      type = "INTERACTIVE";
      interactive = {
        kind: "button_reply",
        id: content?.buttonsResponseMessage?.selectedButtonId ?? "",
        title: content?.buttonsResponseMessage?.selectedDisplayText ?? "",
      };
      break;
    case "listResponseMessage":
      type = "INTERACTIVE";
      interactive = {
        kind: "list_reply",
        id: content?.listResponseMessage?.singleSelectReply?.selectedRowId ?? "",
        title: content?.listResponseMessage?.title ?? "",
      };
      break;
    case "templateMessage":
      type = "TEMPLATE";
      break;
    case "reactionMessage":
      type = "REACTION";
      body = content?.reactionMessage?.text ?? null;
      break;
    default:
      type = "UNSUPPORTED";
  }

  return {
    channelId,
    providerMessageId: msg.key.id,
    from: jidToDigits(msg.key.remoteJid),
    contactName: msg.pushName ?? null,
    timestamp,
    type,
    body,
    media,
    interactive,
    raw: msg,
  };
}

/**
 * Baileys' real ack-status enum, imported as `WAMessageStatus` — the
 * package's own top-level, intentionally-public alias for
 * `proto.WebMessageInfo.Status` (see `export declare const WAMessageStatus:
 * typeof proto.WebMessageInfo.Status` in the package's own
 * `lib/Types/Message.d.ts`, re-exported from its root `index.d.ts`).
 * Verified directly against that generated `.d.ts`, not guessed: `ERROR = 0,
 * PENDING = 1, SERVER_ACK = 2, DELIVERY_ACK = 3, READ = 4, PLAYED = 5`.
 * Mapped onto our four-value `NormalizedStatusEvent` status (context.md
 * §8.0.2 — modelled on Meta's semantics, not Baileys').
 *
 * `PENDING` (1) has no mapping on purpose — it precedes our own
 * PENDING -> SENT transition and carries no information our own status
 * progression (src/lib/messages/status-progression.ts) doesn't already
 * have from the moment `sendText()`'s own result is applied. `PLAYED` (a
 * voice-note-specific ack, stronger than `READ`) maps to our `READ` —
 * forward-only application makes a `READ` arriving after an equal or
 * later `READ` a safe no-op either way.
 */
const ACK_TO_STATUS: Partial<Record<number, NormalizedStatusEvent["status"]>> = {
  [WAMessageStatus.SERVER_ACK]: "SENT",
  [WAMessageStatus.DELIVERY_ACK]: "DELIVERED",
  [WAMessageStatus.READ]: "READ",
  [WAMessageStatus.PLAYED]: "READ",
  [WAMessageStatus.ERROR]: "FAILED",
};

/**
 * Pure Baileys `messages.update` -> `NormalizedStatusEvent` mapping (the
 * status-update counterpart to `normalizeBaileysMessage` above), kept in
 * this dependency-free module for the same reason: zero network/DB
 * dependency, directly unit-testable (see normalize.test.ts).
 *
 * Returns null for an update that doesn't carry an ack-status change at
 * all (Baileys' `messages.update` also fires for edits, reactions, etc. —
 * `update.update` is a `Partial<WAMessage>`, and most fields on it are
 * irrelevant to us) or one whose key has no usable message id.
 */
export function normalizeBaileysStatusUpdate(
  channelId: string,
  update: WAMessageUpdate,
): NormalizedStatusEvent | null {
  const providerMessageId = update.key.id;
  if (!providerMessageId) return null;

  const ackStatus = update.update.status;
  if (ackStatus == null) return null;

  const status = ACK_TO_STATUS[ackStatus];
  if (!status) return null;

  const event: NormalizedStatusEvent = {
    channelId,
    providerMessageId,
    status,
    timestamp: new Date(),
  };

  if (status === "FAILED") {
    // Baileys' messages.update carries only the numeric ack status, not a
    // granular per-message failure reason the way Meta's structured error
    // codes do (context.md §4.7) — flagged in TODO-VERIFY.md. A generic,
    // honest code/message is what we actually know here; never invent a
    // more specific one (context.md rule 2).
    event.errorCode = "BAILEYS_SEND_ERROR";
    event.errorMessage = "WhatsApp reported that this message failed to send.";
  }

  return event;
}
