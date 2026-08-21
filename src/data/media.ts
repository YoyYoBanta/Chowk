import { prisma } from "@/lib/prisma";
import type { Media, Message } from "@prisma/client";
import { mediaToSummary, type MediaSummary } from "@/lib/media/summary";

/**
 * organizationId-required-first-argument pattern (architecture.md §12), no
 * exceptions — same as every other file in src/data/. `Message.mediaId` is
 * a plain scalar (see prisma/schema.prisma's comment above `Media`), so
 * every lookup from a message to its media goes through these functions
 * rather than a Prisma `include`.
 */

export interface CreateMediaInput {
  storageKey: string;
  mimeType: string;
  fileName?: string | null;
  sizeBytes?: number | null;
  metaMediaId?: string | null;
}

export async function createMedia(organizationId: string, input: CreateMediaInput): Promise<Media> {
  return prisma.media.create({
    data: {
      organizationId,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      fileName: input.fileName ?? null,
      sizeBytes: input.sizeBytes ?? null,
      metaMediaId: input.metaMediaId ?? null,
    },
  });
}

export async function getMediaById(organizationId: string, mediaId: string): Promise<Media | null> {
  return prisma.media.findFirst({
    where: { id: mediaId, organizationId },
  });
}

/** Batch lookup for a page of messages (src/data/messages.ts's listMessagesPage
 * result) — one query instead of N. */
export async function getMediaByIds(
  organizationId: string,
  mediaIds: string[],
): Promise<Map<string, Media>> {
  if (mediaIds.length === 0) return new Map();
  const rows = await prisma.media.findMany({
    where: { organizationId, id: { in: mediaIds } },
  });
  return new Map(rows.map((m) => [m.id, m]));
}

export type MessageWithMediaSummary = Message & { media: MediaSummary | null };

/**
 * Enriches one Message with its media summary (or `null` if it has none, or
 * has media that hasn't finished downloading yet — see
 * src/services/media/download-and-store.ts). Used wherever a single
 * message crosses the wire: the send route's 202 response, and
 * src/services/realtime/publish.ts's three publish functions.
 */
export async function attachMediaSummary(
  organizationId: string,
  message: Message,
): Promise<MessageWithMediaSummary> {
  if (!message.mediaId) return { ...message, media: null };
  const media = await getMediaById(organizationId, message.mediaId);
  return { ...message, media: mediaToSummary(media) };
}

/** Same as attachMediaSummary, batched for a page of messages
 * (GET /api/conversations/:id/messages, the thread page's initial SSR
 * load) — one extra query for the whole page instead of one per message. */
export async function attachMediaSummaries(
  organizationId: string,
  messages: Message[],
): Promise<MessageWithMediaSummary[]> {
  const mediaIds = [...new Set(messages.map((m) => m.mediaId).filter((id): id is string => id != null))];
  const mediaMap = await getMediaByIds(organizationId, mediaIds);
  return messages.map((m) => ({
    ...m,
    media: m.mediaId ? mediaToSummary(mediaMap.get(m.mediaId) ?? null) : null,
  }));
}
