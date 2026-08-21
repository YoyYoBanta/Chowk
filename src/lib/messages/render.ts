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

/**
 * M6: `Message.body` for a LOCATION message holds a plain `"lat,lng"`
 * string (src/providers/baileys/normalize.ts — there is no dedicated
 * lat/lng column in context.md §7.4's schema). Parses it back out for
 * rendering a map link (context.md §10.3: "location (map link or
 * coordinates)"); returns null for anything that doesn't match (no
 * coordinates captured, or a non-LOCATION message), so callers can fall
 * back to the generic placeholder.
 */
export function parseLocationBody(body: string | null): { lat: number; lng: number } | null {
  if (!body) return null;
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(body.trim());
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}
