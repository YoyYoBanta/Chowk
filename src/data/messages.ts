import { prisma } from "@/lib/prisma";
import type {
  Direction,
  Message,
  MessageStatus,
  MessageType,
  Prisma,
} from "@prisma/client";
import { encodeCursor } from "@/lib/validation/pagination";

/**
 * organizationId-required-first-argument pattern (architecture.md §12), no
 * exceptions. `findMessageByProviderMessageId` is the ingest-inbound
 * consumer's dedupe check (architecture.md §6) — `providerMessageId` also
 * carries a bare `@unique` at the DB level (prisma/schema.prisma), so this
 * is belt-and-braces: the constraint is what actually prevents a duplicate
 * row under concurrent delivery, this function is just how the org-scoped
 * data layer exposes the same check.
 */

export interface CreateMessageInput {
  conversationId: string;
  provider: string;
  providerMessageId: string | null;
  direction: Direction;
  type: MessageType;
  body?: string | null;
  mediaId?: string | null;
  templateName?: string | null;
  templatePayload?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  interactivePayload?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  rawPayload?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  status?: MessageStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  sentByUserId?: string | null;
  metaTimestamp: Date;
}

export async function createMessage(
  organizationId: string,
  input: CreateMessageInput,
): Promise<Message> {
  return prisma.message.create({
    data: {
      organizationId,
      conversationId: input.conversationId,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      direction: input.direction,
      type: input.type,
      body: input.body,
      mediaId: input.mediaId,
      templateName: input.templateName,
      templatePayload: input.templatePayload,
      interactivePayload: input.interactivePayload,
      rawPayload: input.rawPayload,
      status: input.status,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      sentByUserId: input.sentByUserId,
      metaTimestamp: input.metaTimestamp,
    },
  });
}

export async function findMessageByProviderMessageId(
  organizationId: string,
  providerMessageId: string,
): Promise<Message | null> {
  return prisma.message.findFirst({
    where: { organizationId, providerMessageId },
  });
}

export async function getMessageById(
  organizationId: string,
  messageId: string,
): Promise<Message | null> {
  return prisma.message.findFirst({
    where: { id: messageId, organizationId },
  });
}

export async function listMessagesInConversation(
  organizationId: string,
  conversationId: string,
): Promise<Message[]> {
  return prisma.message.findMany({
    where: { organizationId, conversationId },
    orderBy: { metaTimestamp: "asc" },
  });
}

export interface MessageCursor {
  metaTimestamp: Date;
  id: string;
}

/**
 * M3 addition: cursor-paginated, newest-first (context.md §9's explicit
 * shape for `GET /api/conversations/:id/messages` — "paginated, newest
 * first, cursor-based"). The thread UI reverses each page for
 * oldest-at-top/newest-at-bottom display; the API contract itself stays
 * newest-first so "the next page" always means "older messages",
 * regardless of how the client chooses to render them.
 *
 * Keyset pagination on (metaTimestamp, id), same shape as
 * listConversationsPage above — fetch limit+1, slice, and only emit a
 * cursor when there's genuinely more.
 */
export async function listMessagesPage(
  organizationId: string,
  conversationId: string,
  opts: { limit: number; cursor?: MessageCursor },
): Promise<{ items: Message[]; nextCursor: string | null }> {
  const take = opts.limit + 1;
  const rows = await prisma.message.findMany({
    where: {
      organizationId,
      conversationId,
      ...(opts.cursor
        ? {
            OR: [
              { metaTimestamp: { lt: opts.cursor.metaTimestamp } },
              { metaTimestamp: opts.cursor.metaTimestamp, id: { lt: opts.cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ metaTimestamp: "desc" }, { id: "desc" }],
    take,
  });

  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ metaTimestamp: last.metaTimestamp.toISOString(), id: last.id })
      : null;

  return { items, nextCursor };
}
