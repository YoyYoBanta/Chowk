import { prisma } from "@/lib/prisma";
import type { Conversation } from "@prisma/client";

/**
 * organizationId-required-first-argument pattern (architecture.md §12), no
 * exceptions. `upsertConversationForInbound` backs the ingest-inbound
 * consumer's "upsert Conversation by (channelId, contactId)" step
 * (architecture.md §6), keyed on the real `@@unique([channelId, contactId])`
 * constraint.
 */

export interface UpsertConversationForInboundInput {
  channelId: string;
  contactId: string;
  /** The inbound event's own timestamp — becomes lastMessageAt/lastInboundAt. */
  occurredAt: Date;
}

export async function upsertConversationForInbound(
  organizationId: string,
  input: UpsertConversationForInboundInput,
): Promise<Conversation> {
  return prisma.conversation.upsert({
    where: {
      channelId_contactId: { channelId: input.channelId, contactId: input.contactId },
    },
    create: {
      organizationId,
      channelId: input.channelId,
      contactId: input.contactId,
      status: "OPEN",
      lastMessageAt: input.occurredAt,
      lastInboundAt: input.occurredAt,
      unreadCount: 1,
    },
    update: {
      lastMessageAt: input.occurredAt,
      lastInboundAt: input.occurredAt,
      unreadCount: { increment: 1 },
    },
  });
}

export async function getConversationById(
  organizationId: string,
  conversationId: string,
): Promise<Conversation | null> {
  return prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
  });
}

export async function listConversationsInOrg(organizationId: string): Promise<Conversation[]> {
  return prisma.conversation.findMany({
    where: { organizationId },
    orderBy: { lastMessageAt: "desc" },
  });
}
