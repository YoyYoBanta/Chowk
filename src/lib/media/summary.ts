import type { Media } from "@prisma/client";

/**
 * Pure, framework-agnostic mapping from a stored `Media` row to the small
 * summary shape the UI/wire protocol actually needs — same spirit as
 * src/lib/messages/render.ts's helpers (no DB, no side effects, safe from
 * a Server Component, a Client Component, or a route handler alike).
 *
 * `url` is always a same-origin, authenticated app route
 * (`GET /api/media/:id`, src/app/api/media/[id]/route.ts) rather than a
 * direct object-storage URL — the browser is never assumed to have network
 * access to MinIO/S3 directly, and this keeps every media fetch subject to
 * the same organizationId-scoped session check as everything else.
 */
export interface MediaSummary {
  id: string;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
  url: string;
}

export function mediaToSummary(media: Media | null | undefined): MediaSummary | null {
  if (!media) return null;
  return {
    id: media.id,
    mimeType: media.mimeType,
    fileName: media.fileName,
    sizeBytes: media.sizeBytes,
    url: `/api/media/${media.id}`,
  };
}
