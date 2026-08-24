import { findStuckPendingMessages, markMessageFailed, getMessageById } from "@/data/messages";
import { listOrganizations } from "@/data/organizations";
import { publishMessageStatusChanged } from "@/services/realtime/publish";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * How long a Message can sit PENDING before it's treated as stuck rather
 * than "still legitimately retrying" (architecture.md §7's hardening item:
 * "a scheduled job that flags/re-checks Message rows stuck in PENDING past
 * a timeout"). `send-message` queue's own worst case is 5 attempts at
 * exponential backoff starting at 2s (src/queue/queues.ts) — well under a
 * minute — so 30 minutes is a deliberately generous margin, not a tight
 * SLA: this exists to catch the rare case where the normal retry-then-fail
 * path itself never ran at all (e.g. the job never reached Redis), not to
 * race BullMQ's own backoff.
 */
const STUCK_PENDING_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Marks FAILED, not re-enqueued. Re-enqueueing a message that might
 * already have a job in flight risks two concurrent workers both passing
 * `processSendMessageJob`'s idempotency guard (`status !== PENDING ->
 * skip`) before either has written a new status, and both calling the real
 * provider — an actual double-send, not just a wasted retry. A definitive
 * FAILED (visible to the agent, matching `markSendMessageJobExhausted`'s
 * own precedent for "retries genuinely exhausted") is the safe resolution;
 * an agent can always compose and send again.
 */
export async function reconcileStuckPendingMessagesForOrg(organizationId: string): Promise<number> {
  const correlationId = newCorrelationId();
  const cutoff = new Date(Date.now() - STUCK_PENDING_THRESHOLD_MS);
  const stuck = await findStuckPendingMessages(organizationId, cutoff);

  for (const message of stuck) {
    await markMessageFailed(
      organizationId,
      message.id,
      "STUCK_PENDING_TIMEOUT",
      "This message was stuck and could not be confirmed as sent.",
    );
    logger.warn("reconciliation: stuck PENDING message marked FAILED", {
      organizationId,
      correlationId,
      messageId: message.id,
      conversationId: message.conversationId,
    });

    const updated = await getMessageById(organizationId, message.id);
    if (updated) {
      await publishMessageStatusChanged(organizationId, message.conversationId, updated, { correlationId });
    }
  }

  return stuck.length;
}

/** Every org's stuck-PENDING sweep — the Worker scheduler's periodic tick
 * (src/worker/scheduler.ts). A failure reconciling one org is logged and
 * skipped, same "don't let one org's problem stop the sweep" discipline
 * `syncTemplatesForAllOrgs` already established. */
export async function reconcileStuckPendingMessagesForAllOrgs(): Promise<number> {
  const orgs = await listOrganizations();
  let total = 0;
  for (const org of orgs) {
    try {
      total += await reconcileStuckPendingMessagesForOrg(org.id);
    } catch (error) {
      logger.error("reconciliation failed for organization", {
        organizationId: org.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return total;
}
