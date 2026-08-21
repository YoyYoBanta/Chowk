import type { StatusUpdateJobData } from "@/queue/queues";
import {
  applyForwardOnlyMessageStatus,
  findMessageByProviderAndProviderMessageId,
  getMessageById,
} from "@/data/messages";
import { publishMessageStatusChanged } from "@/services/realtime/publish";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * The transport-agnostic status-update consumer (architecture.md §10 —
 * named alongside window calculation, signature verification, and variable
 * substitution as one of context.md §13's four correctness-bug hotspots).
 *
 *  1. find the Message by (organizationId, provider, providerMessageId)
 *  2. not found -> log + drop. A status CAN legitimately arrive before
 *     send-message.consumer.ts has finished persisting providerMessageId
 *     (a short-lived race) — the status-update queue's own bounded retry
 *     (src/queue/queues.ts's `defaultJobOptions`) covers that; this
 *     function itself never loops or re-enqueues on not-found, since an
 *     indefinite retry here would mean a status event for a message that
 *     will simply never exist (e.g. a stale/malformed provider payload)
 *     retries forever (architecture.md §10 / context.md §4.5's "infinite
 *     retry is not acceptable").
 *  3. found -> apply ONLY if the new status moves forward
 *     (PENDING -> SENT -> DELIVERED -> READ, or -> FAILED from any
 *     non-terminal state) via `applyForwardOnlyMessageStatus`
 *     (src/data/messages.ts), itself built on the explicit ranking
 *     function in src/lib/messages/status-progression.ts rather than an
 *     ad-hoc if/else chain (context.md §13).
 *  4. publish a realtime status-changed event on an actually-applied
 *     transition only — a stale/out-of-order update is ignored silently,
 *     which is the correct behavior here, not a bug (architecture.md §10).
 */
export async function processStatusUpdateJob(data: StatusUpdateJobData): Promise<void> {
  const { organizationId, provider, event } = data;
  const correlationId = newCorrelationId();

  const message = await findMessageByProviderAndProviderMessageId(
    organizationId,
    provider,
    event.providerMessageId,
  );

  if (!message) {
    logger.warn("status-update: no message found for providerMessageId — dropping", {
      organizationId,
      correlationId,
      provider,
      providerMessageId: event.providerMessageId,
      status: event.status,
    });
    return;
  }

  const { applied } = await applyForwardOnlyMessageStatus(organizationId, message.id, {
    status: event.status,
    errorCode: event.errorCode ?? null,
    errorMessage: event.errorMessage ?? null,
  });

  if (!applied) {
    logger.info("status-update: ignored stale/out-of-order status update", {
      organizationId,
      correlationId,
      messageId: message.id,
      provider,
      providerMessageId: event.providerMessageId,
      status: event.status,
    });
    return;
  }

  logger.info("status-update: applied forward status transition", {
    organizationId,
    correlationId,
    messageId: message.id,
    provider,
    providerMessageId: event.providerMessageId,
    status: event.status,
  });

  const updated = await getMessageById(organizationId, message.id);
  if (updated) {
    await publishMessageStatusChanged(organizationId, message.conversationId, updated, {
      correlationId,
    });
  }
}
