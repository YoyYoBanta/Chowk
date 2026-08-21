import type { Message } from "@prisma/client";
import { getConversationById } from "@/data/conversations";
import { createPendingOutboundMessage } from "@/data/messages";
import { getSendMessageQueue, QUEUE_NAMES } from "@/queue/queues";
import { getWhatsAppProvider } from "@/providers/factory";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * The outbound-send sequence (architecture.md §7 / context.md §8.2):
 *
 *   1. verify the conversation belongs to the caller's organizationId
 *   2. insert the Message row, status PENDING — BEFORE anything else
 *   3. enqueue a send-message job carrying only the message's id
 *   4. return the PENDING row
 *
 * No 24-hour window check here on purpose (M5's job — context.md build
 * order is explicit that Tier 1 enforces this itself even though Baileys
 * doesn't need it, but this milestone's own brief says not to even stub
 * it). All sends proceed regardless of window state for now.
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
  | { ok: false; status: 404; error: string };

export async function sendTextMessage(
  input: SendTextMessageInput,
  opts: { correlationId?: string } = {},
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

  // Step 2: PENDING row, before anything else — see the doc comment above.
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

  // Step 3: enqueue, id-only payload.
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
