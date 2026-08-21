import { getConversationById, resetUnreadCount } from "@/data/conversations";
import { getLatestInboundMessageWithProviderId } from "@/data/messages";
import { getWhatsAppProvider } from "@/providers/factory";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * `POST /api/conversations/:id/read` (context.md §8.2 — "when an agent
 * opens a conversation, call [the provider's] mark-as-read endpoint for the
 * latest inbound message... and reset unreadCount locally").
 *
 * The provider call is best-effort and must never fail the whole request:
 * local read-state is our own concern regardless of whether the transport
 * actually got the read receipt (e.g. no live Baileys session yet, or a
 * transient Cloud API error later) — `unreadCount` is always reset to 0
 * even if `markAsRead()` throws.
 */
export type MarkConversationReadResult =
  | { ok: true }
  | { ok: false; status: 404; error: string };

export async function markConversationRead(
  organizationId: string,
  conversationId: string,
  opts: { correlationId?: string } = {},
): Promise<MarkConversationReadResult> {
  const correlationId = opts.correlationId ?? newCorrelationId();

  logger.info("mark-read: start", { organizationId, correlationId, conversationId });

  const conversation = await getConversationById(organizationId, conversationId);
  if (!conversation) {
    logger.info("mark-read: conversation not found for this organization", {
      organizationId,
      correlationId,
      conversationId,
    });
    return { ok: false, status: 404, error: "Conversation not found" };
  }

  const latestInbound = await getLatestInboundMessageWithProviderId(organizationId, conversationId);
  if (latestInbound?.providerMessageId) {
    try {
      await getWhatsAppProvider().markAsRead(conversation.channelId, latestInbound.providerMessageId);
      logger.info("mark-read: provider markAsRead succeeded", {
        organizationId,
        correlationId,
        conversationId,
        messageId: latestInbound.id,
      });
    } catch (error) {
      // Never fail the request over this — see the doc comment above.
      logger.warn("mark-read: provider markAsRead failed — continuing to reset unreadCount", {
        organizationId,
        correlationId,
        conversationId,
        messageId: latestInbound.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    logger.info("mark-read: no inbound message with a providerMessageId yet — skipping provider call", {
      organizationId,
      correlationId,
      conversationId,
    });
  }

  await resetUnreadCount(organizationId, conversationId);
  logger.info("mark-read: unreadCount reset", { organizationId, correlationId, conversationId });

  return { ok: true };
}
