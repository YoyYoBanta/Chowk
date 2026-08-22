import { prisma } from "@/lib/prisma";
import type { Channel, Contact, Conversation, ConversationStatus, Message, Prisma } from "@prisma/client";
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

/**
 * M5 addition: looks a conversation up by the same `(channelId, contactId)`
 * pair `upsertConversationForInbound` upserts on, via the real
 * `@@unique([channelId, contactId])` constraint. This is what
 * src/providers/baileys/simulate-window.ts needs — the Baileys adapter's
 * `sendText`/`sendMedia` only receive a `to` (digits) and `channelId`, not a
 * conversationId, so it has to resolve the conversation the same way an
 * inbound event would have upserted it in the first place.
 */
export async function getConversationByChannelAndContact(
  organizationId: string,
  channelId: string,
  contactId: string,
): Promise<Conversation | null> {
  return prisma.conversation.findFirst({
    where: { organizationId, channelId, contactId },
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
  opts: { 
    limit: number; 
    cursor?: ConversationCursor;
    status?: ConversationStatus;
    assignedUserId?: string | null;
    channelId?: string;
    tagId?: string;
    search?: string;
  },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
  let filteredContactIds: string[] | undefined;

  if (opts.tagId || opts.search) {
    const whereClause: Prisma.ContactWhereInput = { organizationId };

    if (opts.search) {
      whereClause.OR = [
        { name: { contains: opts.search, mode: "insensitive" } },
        { displayName: { contains: opts.search, mode: "insensitive" } },
        { waId: { contains: opts.search } },
      ];
    }

    // Resolve matching contact ids first (by tag and/or search text), then
    // filter the conversation query below by contactId — cheaper than a
    // join for what's still a small-N tag/search result set at Tier 1 scale.
    const contactMatches = await prisma.contact.findMany({
      where: whereClause,
      select: { id: true }
    });
    
    const baseContactIds = contactMatches.map((c: { id: string }) => c.id);

    if (opts.tagId) {
      const contactTags = await prisma.contactTag.findMany({ 
        where: { tagId: opts.tagId }, 
        select: { contactId: true } 
      });
      const taggedIds = new Set(contactTags.map(ct => ct.contactId));
      filteredContactIds = opts.search ? baseContactIds.filter(id => taggedIds.has(id)) : Array.from(taggedIds);
    } else {
      filteredContactIds = baseContactIds;
    }
  }

  const take = opts.limit + 1;
  const rows = await prisma.conversation.findMany({
    where: {
      organizationId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.assignedUserId !== undefined ? { assignedUserId: opts.assignedUserId } : {}),
      ...(opts.channelId ? { channelId: opts.channelId } : {}),
      ...(filteredContactIds ? { contactId: { in: filteredContactIds } } : {}),
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

/**
 * M4 addition: `POST /api/conversations/:id/read` (context.md §8.2 —
 * "reset unreadCount locally") resets it unconditionally, regardless of
 * whether the provider's `markAsRead()` call itself succeeded — local
 * read-state is our own concern, independent of whether the transport got
 * the read receipt.
 */
export async function resetUnreadCount(
  organizationId: string,
  conversationId: string,
): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, organizationId },
    data: { unreadCount: 0 },
  });
}

/** Conversation + contact, for `GET /api/conversations/:id` (detail view).
 * Returns the raw row only — computed 24h-window state (M5) is derived from
 * `lastInboundAt` by the route/page that calls this, via
 * `src/services/window.ts`, never stored or cached here. */
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

export async function updateConversation(
  organizationId: string,
  conversationId: string,
  data: { assignedUserId?: string | null; status?: ConversationStatus }
): Promise<Conversation> {
  const updateData: Prisma.ConversationUpdateInput = {};
  if (data.assignedUserId !== undefined) updateData.assignedUserId = data.assignedUserId;
  if (data.status !== undefined) updateData.status = data.status;

  return prisma.conversation.update({
    where: { id: conversationId, organizationId },
    data: updateData,
  });
}
