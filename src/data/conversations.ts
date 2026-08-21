import { prisma } from "@/lib/prisma";
import type { Channel, Contact, Conversation, Message } from "@prisma/client";
import { encodeCursor } from "@/lib/validation/pagination";

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

/**
 * M3 additions below: the read-only inbox's list/detail queries.
 * Same organizationId-required-first pattern, no exceptions.
 */

export type ConversationListItem = Conversation & {
  contact: Contact;
  channel: Pick<Channel, "id" | "displayName" | "provider">;
  // Only the single latest message, for the list row's preview — never the
  // full thread (that's listMessagesPage, used by the thread view).
  messages: Pick<Message, "id" | "type" | "body" | "direction" | "metaTimestamp">[];
};

export type ConversationWithContact = Conversation & {
  contact: Contact;
  channel: Pick<Channel, "id" | "displayName" | "provider">;
};

export interface ConversationCursor {
  lastMessageAt: Date;
  id: string;
}

/**
 * Cursor-paginated, most-recent-first list (context.md §9 — "offset
 * pagination will break"). Keyset pagination on (lastMessageAt, id) rather
 * than `skip`/`take`: fetches `limit + 1` rows so the presence of the
 * lookahead row tells us whether there's a next page, without a separate
 * COUNT query.
 *
 * Filters (status/assignedTo/channelId/tag/search) are explicitly out of
 * scope for M3 (context.md's own M8/M9 build order) — this lists every
 * conversation in the org, most-recent-first.
 */
export async function listConversationsPage(
  organizationId: string,
  opts: { limit: number; cursor?: ConversationCursor },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
  const take = opts.limit + 1;
  const rows = await prisma.conversation.findMany({
    where: {
      organizationId,
      ...(opts.cursor
        ? {
            OR: [
              { lastMessageAt: { lt: opts.cursor.lastMessageAt } },
              { lastMessageAt: opts.cursor.lastMessageAt, id: { lt: opts.cursor.id } },
            ],
          }
        : {}),
    },
    // nulls: "last" is defensive — every real conversation today is
    // created via upsertConversationForInbound, which always sets
    // lastMessageAt, so this case doesn't currently arise. Still: Postgres'
    // default for DESC is NULLS FIRST, which would otherwise sort a
    // (hypothetically) never-messaged conversation to the very top.
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take,
    include: {
      contact: true,
      channel: { select: { id: true, displayName: true, provider: true } },
      messages: {
        orderBy: { metaTimestamp: "desc" },
        take: 1,
        select: { id: true, type: true, body: true, direction: true, metaTimestamp: true },
      },
    },
  });

  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last && last.lastMessageAt
      ? encodeCursor({ lastMessageAt: last.lastMessageAt.toISOString(), id: last.id })
      : null;

  return { items, nextCursor };
}

/** Conversation + contact, for `GET /api/conversations/:id` (detail view).
 * Computed 24h-window state is deliberately NOT included — that's M5. */
export async function getConversationWithContact(
  organizationId: string,
  conversationId: string,
): Promise<ConversationWithContact | null> {
  return prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    include: {
      contact: true,
      channel: { select: { id: true, displayName: true, provider: true } },
    },
  });
}
