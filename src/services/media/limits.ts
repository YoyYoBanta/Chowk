/**
 * Meta WhatsApp Cloud API media type/size limits (context.md rule 1: fetched
 * live from https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 * on 2026-08-21 — not guessed, not from training data. See TODO-VERIFY.md's
 * M6 section: these are exactly the kind of numbers context.md §4.3/rule 1
 * warns "changed materially" and should be re-verified against live docs
 * before a production deploy, not trusted indefinitely from this file.
 *
 * Enforced identically for outbound sends in both phases (context.md
 * §8.0.4's overall spirit — our own code enforces Meta's rules even where
 * Baileys itself wouldn't) so an agent never attaches a file in Phase A
 * that Phase B would reject.
 *
 * Pure, framework-agnostic — no DB/env imports — safe to import from a
 * Client Component (src/app/(dashboard)/dashboard/_components/composer.tsx
 * uses this to build the file picker's `accept` attribute and the
 * optimistic message type) as well as from the server-side send path
 * (src/services/messages/send-message.ts).
 */

export interface MediaLimit {
  mimeTypes: string[];
  maxBytes: number;
}

/** Tier 1 outbound media kinds (context.md §8.2: "Message types to support
 * in Tier 1: text, image, video, audio, document, and template" —
 * sticker/location/interactive sends are out of scope for outbound). */
export const MEDIA_LIMITS: Record<"image" | "video" | "audio" | "document", MediaLimit> = {
  image: {
    mimeTypes: ["image/jpeg", "image/png"],
    maxBytes: 5 * 1024 * 1024,
  },
  video: {
    mimeTypes: ["video/mp4", "video/3gpp"],
    maxBytes: 16 * 1024 * 1024,
  },
  audio: {
    mimeTypes: ["audio/mpeg", "audio/aac", "audio/amr", "audio/mp4", "audio/ogg"],
    maxBytes: 16 * 1024 * 1024,
  },
  document: {
    mimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ],
    maxBytes: 100 * 1024 * 1024,
  },
};

export type OutboundMediaKind = keyof typeof MEDIA_LIMITS;

export const ALL_SUPPORTED_MIME_TYPES: string[] = Object.values(MEDIA_LIMITS).flatMap(
  (limit) => limit.mimeTypes,
);

export function mediaKindForMime(mimeType: string): OutboundMediaKind | null {
  for (const kind of Object.keys(MEDIA_LIMITS) as OutboundMediaKind[]) {
    if (MEDIA_LIMITS[kind].mimeTypes.includes(mimeType)) return kind;
  }
  return null;
}

export function messageTypeForMediaKind(kind: OutboundMediaKind): "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" {
  switch (kind) {
    case "image":
      return "IMAGE";
    case "video":
      return "VIDEO";
    case "audio":
      return "AUDIO";
    case "document":
      return "DOCUMENT";
  }
}

export interface MediaValidationResult {
  ok: boolean;
  error?: string;
}

/** Validates BEFORE upload (context.md §8.3) — never after we've already
 * spent the effort storing/sending an oversized or unsupported file. */
export function validateOutboundMedia(mimeType: string, sizeBytes: number): MediaValidationResult {
  const kind = mediaKindForMime(mimeType);
  if (!kind) {
    return { ok: false, error: `Unsupported file type: ${mimeType || "unknown"}` };
  }
  const limit = MEDIA_LIMITS[kind];
  if (sizeBytes > limit.maxBytes) {
    const limitMb = Math.floor(limit.maxBytes / (1024 * 1024));
    return { ok: false, error: `File is too large — the limit for ${kind} files is ${limitMb}MB` };
  }
  return { ok: true };
}
