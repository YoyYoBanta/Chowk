import type { Direction, MessageType } from "@prisma/client";

/**
 * Shared, pure, framework-agnostic helpers for rendering a `Message` row —
 * used by both the conversation-list API's server-side preview text and
 * the thread UI's per-message placeholders. No provider imports, no
 * side effects — safe to call from a Server Component, a Client
 * Component, or a route handler alike.
 *
 * context.md §10.3: render every message type; unmapped/unknown types
 * (persisted as `MessageType.UNSUPPORTED`) get a neutral placeholder.
 * Full rich rendering per type (image lightbox, video/audio players,
 * document download, map links, etc.) is explicitly M6/M7's job, not
 * M3's — these are minimal, honest placeholders only.
 */

const TYPE_LABELS: Record<MessageType, string> = {
  TEXT: "Text",
  IMAGE: "Photo",
  VIDEO: "Video",
  AUDIO: "Audio",
  DOCUMENT: "Document",
  STICKER: "Sticker",
  LOCATION: "Location",
  CONTACTS: "Contact card",
  INTERACTIVE: "Interactive reply",
  TEMPLATE: "Template",
  BUTTON: "Button reply",
  REACTION: "Reaction",
  UNSUPPORTED: "Unsupported message",
};

export function messageTypeLabel(type: MessageType): string {
  return TYPE_LABELS[type] ?? "Unsupported message";
}

/** One-line preview for a conversation list row. */
export function messagePreviewText(message: { type: MessageType; body: string | null }): string {
  if (message.type === "TEXT" && message.body) {
    return message.body.length > 120 ? `${message.body.slice(0, 117)}...` : message.body;
  }
  return `[${messageTypeLabel(message.type)}]`;
}

export function isOutbound(direction: Direction): boolean {
  return direction === "OUTBOUND";
}
