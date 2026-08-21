import { prisma } from "@/lib/prisma";
import type {
  Direction,
  Message,
  MessageStatus,
  MessageType,
  Prisma,
} from "@prisma/client";
import { encodeCursor } from "@/lib/validation/pagination";
import { statusesBelow } from "@/lib/messages/status-progression";

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

/**
 * M4 additions below: outbound send (architecture.md §7) and status-update
 * (architecture.md §10) data access. Same organizationId-required-first
 * pattern as every function above, no exceptions.
 */

export interface CreatePendingOutboundMessageInput {
  conversationId: string;
  provider: string;
  type: MessageType;
  body?: string | null;
  sentByUserId: string;
  metaTimestamp?: Date;
}

/**
 * The PENDING-before-send insert (architecture.md §7 / context.md §8.2 step
 * 3): `src/services/messages/send-message.ts` calls this BEFORE enqueueing
 * the send-message job, and the real provider call only ever happens later,
 * in the Worker process, driven by that job — so a crash at any point
 * between this insert and the provider actually running can only ever
 * leave a recoverable PENDING row, never lose the message.
 */
export async function createPendingOutboundMessage(
  organizationId: string,
  input: CreatePendingOutboundMessageInput,
): Promise<Message> {
  return prisma.message.create({
    data: {
      organizationId,
      conversationId: input.conversationId,
      provider: input.provider,
      providerMessageId: null,
      direction: "OUTBOUND",
      type: input.type,
      body: input.body ?? null,
      status: "PENDING",
      sentByUserId: input.sentByUserId,
      metaTimestamp: input.metaTimestamp ?? new Date(),
    },
  });
}

/** send-message.consumer.ts, on a successful `SendResult`. */
export async function markMessageSent(
  organizationId: string,
  messageId: string,
  providerMessageId: string,
): Promise<void> {
  await prisma.message.updateMany({
    where: { id: messageId, organizationId },
    data: { providerMessageId, status: "SENT" },
  });
}

/** send-message.consumer.ts, on a terminal (non-retryable) `SendResult`, or
 * once BullMQ has exhausted every configured retry attempt for a
 * retryable one. Never called on a message that isn't still PENDING. */
export async function markMessageFailed(
  organizationId: string,
  messageId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await prisma.message.updateMany({
    where: { id: messageId, organizationId },
    data: { status: "FAILED", errorCode, errorMessage },
  });
}

/**
 * status-update.consumer.ts's lookup step (architecture.md §10): finds the
 * outbound Message a `NormalizedStatusEvent` refers to, scoped by both
 * organizationId and provider — a Phase A id and a Phase B id never
 * collide even if the string happened to match (context.md §8.0.2),
 * mirroring the ingest-inbound consumer's own dedupe scoping.
 */
export async function findMessageByProviderAndProviderMessageId(
  organizationId: string,
  provider: string,
  providerMessageId: string,
): Promise<Message | null> {
  return prisma.message.findFirst({
    where: { organizationId, provider, providerMessageId },
  });
}

/** Latest INBOUND message in a conversation that actually has a
 * providerMessageId — what `POST /api/conversations/:id/read` needs to
 * call `provider.markAsRead(channelId, providerMessageId)` against
 * (context.md §8.2). */
export async function getLatestInboundMessageWithProviderId(
  organizationId: string,
  conversationId: string,
): Promise<Message | null> {
  return prisma.message.findFirst({
    where: {
      organizationId,
      conversationId,
      direction: "INBOUND",
      providerMessageId: { not: null },
    },
    orderBy: { metaTimestamp: "desc" },
  });
}

/**
 * The forward-only status apply (context.md §7.4 / §13, architecture.md
 * §10 — named as a correctness-bug hotspot). Implemented as a single
 * atomic conditional UPDATE — `WHERE status IN (<ranks below target>)` —
 * rather than a read-then-write pair, so there is no window for a
 * concurrent status update to slip in between reading the current status
 * and writing the new one. `statusesBelow` (src/lib/messages/status-progression.ts)
 * is the one place the actual ordering is defined; this function only
 * turns that into a `WHERE ... IN (...)` clause.
 *
 * Returns `applied: false` both when the message doesn't move forward
 * (stale/out-of-order — architecture.md §10: "ignore silently, this IS the
 * correct behavior") and, as a degenerate case, when `next.status` is
 * PENDING (nothing ever legitimately ranks below PENDING, so
 * `statusesBelow` returns an empty set and the query is skipped entirely
 * rather than issuing an `IN ()` that would match nothing anyway).
 */
export async function applyForwardOnlyMessageStatus(
  organizationId: string,
  messageId: string,
  next: { status: MessageStatus; errorCode?: string | null; errorMessage?: string | null },
): Promise<{ applied: boolean }> {
  const allowedFrom = statusesBelow(next.status);
  if (allowedFrom.length === 0) {
    return { applied: false };
  }

  const result = await prisma.message.updateMany({
    where: { id: messageId, organizationId, status: { in: allowedFrom } },
    data: {
      status: next.status,
      ...(next.status === "FAILED"
        ? { errorCode: next.errorCode ?? null, errorMessage: next.errorMessage ?? null }
        : {}),
    },
  });

  return { applied: result.count > 0 };
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
