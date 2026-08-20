import { prisma } from "@/lib/prisma";
import type {
  Direction,
  Message,
  MessageStatus,
  MessageType,
  Prisma,
} from "@prisma/client";

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
