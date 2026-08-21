import type { SendMessageJobData } from "@/queue/queues";
import { getMessageById, markMessageFailed, markMessageSent } from "@/data/messages";
import { getConversationWithContact } from "@/data/conversations";
import { getWhatsAppProvider } from "@/providers/factory";
import { publishMessageStatusChanged } from "@/services/realtime/publish";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * The transport-agnostic outbound-send consumer (architecture.md §7). Loads
 * the `Message` by id (never trusts a payload beyond `{ organizationId,
 * messageId }` — architecture.md §13, so a retried job always re-reads
 * current DB state), calls `provider.sendText()`, and applies the result:
 *
 *  - `ok: true`                    -> providerMessageId captured, SENT
 *  - `ok: false, retryable: true`  -> THROW, handing control back to
 *                                     BullMQ's own attempts/backoff
 *                                     (configured on the send-message queue,
 *                                     src/queue/queues.ts) — never manually
 *                                     re-enqueued
 *  - `ok: false, retryable: false` -> FAILED + errorCode/errorMessage,
 *                                     terminal, never retried
 *
 * The retryable/terminal split is what makes "throw vs. don't throw" the
 * right signal to BullMQ: a terminal failure resolves this function
 * normally (the DB write already fully describes the outcome), so BullMQ
 * sees a "completed" job and never retries it, exactly matching context.md
 * §4.7 ("never retry a terminal error").
 */
export async function processSendMessageJob(data: SendMessageJobData): Promise<void> {
  const { organizationId, messageId } = data;
  const correlationId = newCorrelationId();

  const message = await getMessageById(organizationId, messageId);
  if (!message) {
    // Shouldn't happen in practice — the job's messageId comes from a row
    // send-message.ts just created moments earlier. Retrying can't fix a
    // row that doesn't exist, so this is a log-and-stop, not a throw.
    logger.error("send-message job: message not found — dropping", {
      organizationId,
      correlationId,
      messageId,
    });
    return;
  }

  if (message.status !== "PENDING") {
    // Idempotency guard (architecture.md §13 — "jobs... idempotent and
    // DB-state-driven"): a previous attempt already moved this message past
    // PENDING (e.g. the DB write succeeded but the job crashed before
    // BullMQ could ack it, and got redelivered). Never double-send.
    logger.info("send-message job: message already processed — skipping resend", {
      organizationId,
      correlationId,
      messageId,
      status: message.status,
    });
    return;
  }

  const conversation = await getConversationWithContact(organizationId, message.conversationId);
  if (!conversation) {
    // The conversation existed when send-message.ts created this row —
    // this would mean it's since vanished, which shouldn't happen. Nothing
    // a retry could fix: terminal.
    await markMessageFailed(
      organizationId,
      messageId,
      "CONVERSATION_NOT_FOUND",
      "This conversation could no longer be found.",
    );
    logger.error("send-message job: conversation not found — marked FAILED", {
      organizationId,
      correlationId,
      messageId,
      conversationId: message.conversationId,
    });
    await publishUpdatedStatus(organizationId, message.conversationId, messageId, correlationId);
    return;
  }

  logger.info("send-message job: sending", {
    organizationId,
    correlationId,
    messageId,
    conversationId: message.conversationId,
    channelId: conversation.channel.id,
  });

  const result = await getWhatsAppProvider().sendText({
    channelId: conversation.channel.id,
    to: conversation.contact.waId,
    body: message.body ?? "",
  });

  if (result.ok) {
    await markMessageSent(organizationId, messageId, result.providerMessageId);
    logger.info("send-message job: sent", {
      organizationId,
      correlationId,
      messageId,
      providerMessageId: result.providerMessageId,
    });
    await publishUpdatedStatus(organizationId, message.conversationId, messageId, correlationId);
    return;
  }

  if (result.retryable) {
    logger.warn("send-message job: retryable send failure — handing back to BullMQ backoff", {
      organizationId,
      correlationId,
      messageId,
      errorCode: result.code,
      errorMessage: result.message,
    });
    throw new Error(`send-message retryable failure [${result.code}]: ${result.message}`);
  }

  await markMessageFailed(organizationId, messageId, result.code, result.message);
  logger.error("send-message job: terminal send failure — marked FAILED", {
    organizationId,
    correlationId,
    messageId,
    errorCode: result.code,
    errorMessage: result.message,
  });
  await publishUpdatedStatus(organizationId, message.conversationId, messageId, correlationId);
}

async function publishUpdatedStatus(
  organizationId: string,
  conversationId: string,
  messageId: string,
  correlationId: string,
): Promise<void> {
  const updated = await getMessageById(organizationId, messageId);
  if (!updated) return;
  await publishMessageStatusChanged(organizationId, conversationId, updated, { correlationId });
}

/**
 * Called from src/worker/index.ts's `failed` handler once BullMQ has
 * exhausted every configured retry attempt for a send-message job
 * (`job.attemptsMade >= (job.opts.attempts ?? 1)`) — a message must never
 * be left silently PENDING forever just because every retry happened to
 * fail (context.md rule 6: "write the failure path first... silent
 * failure is the worst outcome"). Idempotent: a no-op if the message
 * already moved past PENDING by the time this runs (e.g. a later attempt
 * actually succeeded before BullMQ gave up, or another path already marked
 * it FAILED).
 */
export async function markSendMessageJobExhausted(
  data: SendMessageJobData,
  lastError: unknown,
): Promise<void> {
  const { organizationId, messageId } = data;
  const message = await getMessageById(organizationId, messageId);
  if (!message || message.status !== "PENDING") return;

  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  await markMessageFailed(
    organizationId,
    messageId,
    "RETRY_EXHAUSTED",
    "We couldn't send this message after several attempts.",
  );
  logger.error("send-message job: retries exhausted — marked FAILED", {
    organizationId,
    messageId,
    errorMessage,
  });

  await publishUpdatedStatus(organizationId, message.conversationId, messageId, newCorrelationId());
}
