import type { Message } from "@prisma/client";
import { getConversationById } from "@/data/conversations";
import { createPendingOutboundMessage } from "@/data/messages";
import { getSendMessageQueue, QUEUE_NAMES } from "@/queue/queues";
import { getWhatsAppProvider } from "@/providers/factory";
import { isWindowOpen } from "@/services/window";
import { logger, newCorrelationId } from "@/lib/logging/logger";
import { storeOutboundMedia } from "@/services/media/upload-outbound";
import { mediaKindForMime, messageTypeForMediaKind, validateOutboundMedia } from "@/services/media/limits";

/**
 * The outbound-send sequence (architecture.md §7 / context.md §8.2):
 *
 *   1. verify the conversation belongs to the caller's organizationId
 *   2. (M5) confirm the 24-hour service window is open — reject BEFORE
 *      anything else if it's closed
 *   3. insert the Message row, status PENDING — BEFORE anything else
 *   4. enqueue a send-message job carrying only the message's id
 *   5. return the PENDING row
 *
 * The window check (M5, context.md §4.1/§8.2 step 2: "if the message is
 * free-form, confirm the 24-hour window is open... do not rely on the
 * client to enforce this") happens BEFORE the PENDING insert/enqueue on
 * purpose: a window-closed rejection must leave no `Message` row at all —
 * it's not a failed send (which does get a PENDING-then-FAILED row), it's a
 * send that never happened. `isWindowOpen` (src/services/window.ts) is the
 * one place that comparison is computed; this function only calls it.
 *
 * `opts.skipWindowCheck` exists so a future template-send call site (M7 —
 * templates are the one thing Meta allows outside the window) can reuse
 * this same function's PENDING-insert/enqueue plumbing without the
 * free-form check applying to it. No caller in this milestone passes
 * `true` — every text send enforces the window.
 *
 * Why the PENDING insert happens first, and why that's the actual point of
 * this milestone (architecture.md §7): "if the Worker process dies
 * mid-send, the row exists as PENDING rather than the send vanishing with
 * no trace." The real provider call never happens in this function at
 * all — it happens later, in a different process (the Worker), driven
 * entirely by the job this function enqueues. That means the ordering
 * guarantee here is structural, not just "call insert before call": a
 * crash any time between "this function returns" and "the Worker actually
 * invokes provider.sendText()" can only ever leave a recoverable PENDING
 * row, never lose the message. See
 * src/worker/consumers/send-message.consumer.integration.test.ts for the
 * real-Postgres proof of this holding even when the provider call itself
 * throws.
 *
 * The job carries only `{ organizationId, messageId }` — never the body/
 * type/etc. (architecture.md §13) — so a retried job always re-reads
 * current DB state rather than replaying a possibly-stale payload.
 */
export interface SendTextMessageInput {
  organizationId: string;
  conversationId: string;
  userId: string;
  body: string;
}

export type SendMessageResult =
  | { ok: true; message: Message }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 409; code: "WINDOW_CLOSED"; error: string }
  | { ok: false; status: 400; code: "INVALID_MEDIA"; error: string };

export interface SendTextMessageOpts {
  correlationId?: string;
  /** Skips the 24h window check entirely — see the doc comment above. No
   * caller in this milestone sets this; it exists for a future
   * template-send call site (M7). */
  skipWindowCheck?: boolean;
}

export async function sendTextMessage(
  input: SendTextMessageInput,
  opts: SendTextMessageOpts = {},
): Promise<SendMessageResult> {
  const { organizationId, conversationId, userId, body } = input;
  const correlationId = opts.correlationId ?? newCorrelationId();

  logger.info("send-message: start", {
    organizationId,
    correlationId,
    conversationId,
    userId,
  });

  const conversation = await getConversationById(organizationId, conversationId);
  if (!conversation) {
    logger.info("send-message: conversation not found for this organization", {
      organizationId,
      correlationId,
      conversationId,
    });
    return { ok: false, status: 404, error: "Conversation not found" };
  }

  // Step 2 (M5): the window check, BEFORE the PENDING insert/enqueue below
  // — see this file's own doc comment for why a window-closed rejection
  // must never create a Message row at all.
  if (!opts.skipWindowCheck && !isWindowOpen(conversation.lastInboundAt)) {
    logger.info("send-message: rejected, 24h service window closed", {
      organizationId,
      correlationId,
      conversationId,
    });
    return {
      ok: false,
      status: 409,
      code: "WINDOW_CLOSED",
      error:
        "The 24-hour reply window has closed for this conversation. Send an approved template message to reopen it.",
    };
  }

  // Step 3: PENDING row, before anything else — see the doc comment above.
  const message = await createPendingOutboundMessage(organizationId, {
    conversationId,
    // Tags the row with whichever transport is actually configured to send
    // it (context.md §8.0.3's one factory) — not a provider-name branch,
    // just recording which adapter will attempt this send.
    provider: getWhatsAppProvider().name,
    type: "TEXT",
    body,
    sentByUserId: userId,
  });

  // Step 4: enqueue, id-only payload.
  await getSendMessageQueue().add(QUEUE_NAMES.sendMessage, {
    organizationId,
    messageId: message.id,
  });

  logger.info("send-message: PENDING row created, job enqueued", {
    organizationId,
    correlationId,
    conversationId,
    messageId: message.id,
  });

  return { ok: true, message };
}

/**
 * M6: the media counterpart to sendTextMessage above. Same sequence — org
 * check, window check, PENDING-before-anything-else, id-only enqueue — with
 * one extra step in the middle: validate the file (context.md §8.3, before
 * any upload) and store OUR OWN copy to object storage FIRST
 * (src/services/media/upload-outbound.ts's storeOutboundMedia), because
 * `createPendingOutboundMessage` needs a real `Media.id` to set as
 * `mediaId` — unlike an inbound media message (whose mediaId starts null
 * and gets linked later by the async download-and-store pipeline), an
 * outbound message's mediaId is set at creation time, before the provider
 * has even been asked to upload/send anything.
 *
 * The actual `provider.uploadMedia()` → `provider.sendMedia()` calls happen
 * later, in the Worker (src/worker/consumers/send-message.consumer.ts) —
 * same PENDING-row-survives-a-crash guarantee as the text path, and the
 * same generic send-message queue/consumer handles both (architecture.md
 * §13: the job payload is just `{ organizationId, messageId }` either way).
 */
export interface SendMediaMessageInput {
  organizationId: string;
  conversationId: string;
  userId: string;
  file: Buffer;
  mimeType: string;
  fileName: string | null;
  caption?: string | null;
}

export async function sendMediaMessage(
  input: SendMediaMessageInput,
  opts: SendTextMessageOpts = {},
): Promise<SendMessageResult> {
  const { organizationId, conversationId, userId, file, mimeType, fileName, caption } = input;
  const correlationId = opts.correlationId ?? newCorrelationId();

  logger.info("send-media-message: start", {
    organizationId,
    correlationId,
    conversationId,
    userId,
    mimeType,
    sizeBytes: file.length,
  });

  const conversation = await getConversationById(organizationId, conversationId);
  if (!conversation) {
    logger.info("send-media-message: conversation not found for this organization", {
      organizationId,
      correlationId,
      conversationId,
    });
    return { ok: false, status: 404, error: "Conversation not found" };
  }

  // Media is a free-form send just like text (context.md §4.1: "Inside the
  // window: any free-form message may be sent — text, media, interactive"),
  // so the identical window check applies, in the identical position —
  // BEFORE storing anything or creating any row.
  if (!opts.skipWindowCheck && !isWindowOpen(conversation.lastInboundAt)) {
    logger.info("send-media-message: rejected, 24h service window closed", {
      organizationId,
      correlationId,
      conversationId,
    });
    return {
      ok: false,
      status: 409,
      code: "WINDOW_CLOSED",
      error:
        "The 24-hour reply window has closed for this conversation. Send an approved template message to reopen it.",
    };
  }

  const validation = validateOutboundMedia(mimeType, file.length);
  if (!validation.ok) {
    logger.info("send-media-message: rejected, invalid media", {
      organizationId,
      correlationId,
      conversationId,
      mimeType,
      sizeBytes: file.length,
    });
    return { ok: false, status: 400, code: "INVALID_MEDIA", error: validation.error ?? "Invalid file" };
  }

  const media = await storeOutboundMedia(organizationId, file, mimeType, fileName);

  // Safe to assert non-null: validateOutboundMedia above already confirmed
  // mimeType maps to a known kind.
  const kind = mediaKindForMime(mimeType)!;

  const message = await createPendingOutboundMessage(organizationId, {
    conversationId,
    provider: getWhatsAppProvider().name,
    type: messageTypeForMediaKind(kind),
    body: caption ?? null,
    mediaId: media.id,
    sentByUserId: userId,
  });

  await getSendMessageQueue().add(QUEUE_NAMES.sendMessage, {
    organizationId,
    messageId: message.id,
  });

  logger.info("send-media-message: PENDING row created, job enqueued", {
    organizationId,
    correlationId,
    conversationId,
    messageId: message.id,
    mediaId: media.id,
  });

  return { ok: true, message };
}
