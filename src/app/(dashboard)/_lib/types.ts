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
  /** M5: server-computed (src/services/window.ts) — true when this
   * conversation's 24h window closes in under 2 hours. Never re-derived
   * client-side from lastInboundAt. */
  isClosingSoon: boolean;
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

/** M6: the small, authenticated-URL-bearing view of a stored `Media` row —
 * see src/lib/media/summary.ts's mediaToSummary (the single shared server
 * implementation this mirrors). */
export interface MediaSummaryDTO {
  id: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
  url: string;
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
  /** M6: null for a non-media message, or for a media message whose file
   * hasn't finished downloading yet (see message.updated below — a live
   * event fires once it has). */
  media: MediaSummaryDTO | null;
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
  /** M5, all server-computed (src/services/window.ts) from the real
   * lastInboundAt on every request — never cached, never re-derived
   * client-side. The composer's open/closed state is driven entirely by
   * `isWindowOpen`; `closesAt`/`remainingMs` are only for display (the
   * countdown text). */
  isWindowOpen: boolean;
  closesAt: string | null;
  remainingMs: number | null;
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

/** M4 addition: published after every status transition a sent message
 * goes through (PENDING -> SENT/FAILED via the send-message consumer,
 * or forward progress via the status-update consumer) — see
 * src/services/realtime/publish.ts's publishMessageStatusChanged. Carries
 * the full message row, same as message.created, so a client that hasn't
 * seen this id yet can treat it identically to a brand-new message. */
export interface MessageStatusChangedRealtimeEvent {
  type: "message.status_changed";
  organizationId: string;
  conversationId: string;
  message: MessageDTO;
}

/** M6 addition: fires when a message's media finishes downloading and
 * `mediaId` gets linked (src/services/media/download-and-store.ts) — see
 * src/services/realtime/publish.ts's publishMessageUpdated for why this
 * isn't folded into message.status_changed (status is meaningless for an
 * INBOUND message). Handled identically to status_changed client-side. */
export interface MessageUpdatedRealtimeEvent {
  type: "message.updated";
  organizationId: string;
  conversationId: string;
  message: MessageDTO;
}

export type ConversationRealtimeEvent =
  | MessageCreatedRealtimeEvent
  | MessageStatusChangedRealtimeEvent
  | MessageUpdatedRealtimeEvent;
