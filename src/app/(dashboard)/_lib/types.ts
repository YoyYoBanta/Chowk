import type { ConversationStatus, Direction, MessageType } from "@prisma/client";

/**
 * Client-side shapes matching what `/api/conversations*` actually return
 * over the wire (JSON — so every `Date` on the Prisma models becomes an
 * ISO string here). Kept in the `(dashboard)` route group since these are
 * UI-only DTOs, not part of the org-scoped data-access layer.
 */

export interface ConversationListItemDTO {
  id: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  contact: {
    id: string;
    name: string | null;
    displayName: string | null;
    waId: string;
  };
  channel: {
    id: string;
    displayName: string;
    provider: string;
  };
  lastMessagePreview: string | null;
  lastMessageDirection: Direction | null;
}

export interface ConversationsListResponse {
  conversations: ConversationListItemDTO[];
  nextCursor: string | null;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  provider: string;
  providerMessageId: string | null;
  direction: Direction;
  type: MessageType;
  body: string | null;
  mediaId: string | null;
  templateName: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  metaTimestamp: string;
  createdAt: string;
}

export interface MessagesPageResponse {
  messages: MessageDTO[];
  nextCursor: string | null;
}

export interface ConversationDetailDTO {
  id: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  channel: { id: string; displayName: string; provider: string };
  contact: {
    id: string;
    name: string | null;
    displayName: string | null;
    waId: string;
    isBlocked: boolean;
  };
}

export interface ConversationDetailResponse {
  conversation: ConversationDetailDTO;
}

export interface MessageCreatedRealtimeEvent {
  type: "message.created";
  organizationId: string;
  conversationId: string;
  message: MessageDTO;
}
