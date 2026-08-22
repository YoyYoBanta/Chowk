import type { Message } from "@prisma/client";
import type { SendMessageJobData } from "@/queue/queues";
import { getMessageById, markMessageFailed, markMessageSent } from "@/data/messages";
import { getConversationWithContact, type ConversationWithContact } from "@/data/conversations";
import { getMediaById } from "@/data/media";
import { getTemplateByName } from "@/data/templates";
import { getWhatsAppProvider } from "@/providers/factory";
import { uploadStoredMediaToProvider } from "@/services/media/upload-outbound";
import type { SendResult } from "@/providers/types";
import { publishMessageStatusChanged } from "@/services/realtime/publish";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * The transport-agnostic outbound-send consumer (architecture.md §7). Loads
 * the `Message` by id (never trusts a payload beyond `{ organizationId,
 * messageId }` — architecture.md §13, so a retried job always re-reads
 * current DB state), calls `provider.sendText()` or, for a media message
 * (M6), `provider.uploadMedia()` + `provider.sendMedia()` (see
 * sendMediaViaProvider below), and applies the result:
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
    // Reuses the existing `messageType` field (LogFields) — same name the
    // ingest-inbound consumer's own "message ingested" log line already
    // uses for the identical concept — rather than adding a near-duplicate
    // `type` field.
    messageType: message.type,
  });

  let result: SendResult;
  if (message.type === "TEXT") {
    result = await getWhatsAppProvider().sendText({
      channelId: conversation.channel.id,
      to: conversation.contact.waId,
      body: message.body ?? "",
    });
  } else if (message.type === "TEMPLATE") {
    const templateResult = await sendTemplateViaProvider(organizationId, conversation, message);
    if (!templateResult.ok) {
      await markMessageFailed(organizationId, messageId, templateResult.code, templateResult.message);
      logger.error("send-message job: terminal template send failure — marked FAILED", {
        organizationId,
        correlationId,
        messageId,
        errorCode: templateResult.code,
      });
      await publishUpdatedStatus(organizationId, message.conversationId, messageId, correlationId);
      return;
    }
    result = templateResult.result;
  } else {
    const mediaResult = await sendMediaViaProvider(organizationId, conversation, message);
    if (!mediaResult.ok) {
      await markMessageFailed(organizationId, messageId, mediaResult.code, mediaResult.message);
      logger.error("send-message job: terminal media send failure — marked FAILED", {
        organizationId,
        correlationId,
        messageId,
        errorCode: mediaResult.code,
        errorMessage: mediaResult.message,
      });
      await publishUpdatedStatus(organizationId, message.conversationId, messageId, correlationId);
      return;
    }
    result = mediaResult.result;
  }

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

type MediaSendOutcome = { ok: true; result: SendResult } | { ok: false; code: string; message: string };

/**
 * M6: the media counterpart of the plain `provider.sendText()` call above.
 * Loads the `Media` row the outbound send already created (src/services/
 * messages/send-message.ts's sendMediaMessage — `message.mediaId` is set
 * from the moment the PENDING row was created, unlike an inbound media
 * message), reads our own stored bytes back out, and does the two-step
 * architecture.md §8 outbound sequence: `uploadMedia()` then `sendMedia()`.
 *
 * The `{ ok: false, code, message }` branch here is for conditions a retry
 * can never fix (no mediaId on the row at all, or the Media row it points
 * to has vanished) — genuinely exceptional, not a normal provider failure
 * mode, so these are reported as an immediate terminal outcome rather than
 * thrown. An actual failure from `uploadStoredMediaToProvider()` or
 * `provider.sendMedia()` itself (network error, no live session, etc.) is
 * NOT caught here — it propagates as a thrown exception exactly like any
 * other unexpected error in processSendMessageJob, letting BullMQ's own
 * retry/backoff handle it the same way a `getConversationWithContact()`
 * throw already would.
 */
async function sendMediaViaProvider(
  organizationId: string,
  conversation: ConversationWithContact,
  message: Message,
): Promise<MediaSendOutcome> {
  if (!message.mediaId) {
    return {
      ok: false,
      code: "MISSING_MEDIA",
      message: "This message has no attached file to send.",
    };
  }

  const media = await getMediaById(organizationId, message.mediaId);
  if (!media) {
    return {
      ok: false,
      code: "MEDIA_NOT_FOUND",
      message: "The attached file could not be found.",
    };
  }

  const mediaRef = await uploadStoredMediaToProvider(conversation.channel.id, media);
  const result = await getWhatsAppProvider().sendMedia({
    channelId: conversation.channel.id,
    to: conversation.contact.waId,
    media: mediaRef,
    caption: message.body ?? undefined,
  });

  return { ok: true, result };
}

type TemplateSendOutcome = { ok: true; result: SendResult } | { ok: false; code: string; message: string };

/**
 * M7: the template counterpart of sendMediaViaProvider above. `message.templatePayload`
 * carries `{ languageCode, variables }` (src/services/messages/send-message.ts's
 * sendTemplateMessage doc comment explains why languageCode travels here
 * instead of a dedicated Message column).
 *
 * This is send-time re-check #2 of 2 for context.md §8.4's "never send a
 * template whose local status is not APPROVED... check at send time, not
 * just at selection time": sendTemplateMessage already checked APPROVED
 * once before enqueueing, but Meta's own sync (or a paused/rejected status
 * landing) could flip it in the gap between that check and this job
 * actually running — so the exact same check happens again here,
 * immediately before the real provider.sendTemplate() call.
 */
async function sendTemplateViaProvider(
  organizationId: string,
  conversation: ConversationWithContact,
  message: Message,
): Promise<TemplateSendOutcome> {
  if (!message.templateName || !message.templatePayload) {
    return {
      ok: false,
      code: "MISSING_TEMPLATE_DATA",
      message: "Template name or payload is missing.",
    };
  }

  const payload = message.templatePayload as { languageCode?: string; variables?: Record<string, string> };
  if (!payload.languageCode || !payload.variables) {
    return {
      ok: false,
      code: "MISSING_TEMPLATE_DATA",
      message: "Template language or variables are missing.",
    };
  }

  const template = await getTemplateByName(
    organizationId,
    conversation.channel.id,
    message.templateName,
    payload.languageCode,
  );
  if (!template) {
    return {
      ok: false,
      code: "TEMPLATE_NOT_FOUND",
      message: "This template could no longer be found.",
    };
  }
  if (template.status !== "APPROVED") {
    return {
      ok: false,
      code: "TEMPLATE_NOT_APPROVED",
      message: `This template is no longer approved (status: ${template.status}).`,
    };
  }

  const result = await getWhatsAppProvider().sendTemplate({
    channelId: conversation.channel.id,
    to: conversation.contact.waId,
    templateName: message.templateName,
    languageCode: payload.languageCode,
    variables: payload.variables,
  });

  return { ok: true, result };
}
