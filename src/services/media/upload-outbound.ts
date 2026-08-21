import { randomUUID } from "node:crypto";
import type { Media } from "@prisma/client";
import { createMedia } from "@/data/media";
import { getObjectBuffer, putObject } from "@/lib/storage/object-store";
import { getWhatsAppProvider } from "@/providers/factory";
import type { MediaReference } from "@/providers/types";

/**
 * Outbound media, step 1 of 2 (architecture.md §8 / context.md §8.3): store
 * OUR OWN copy to object storage and create the `Media` row, at request
 * time — before the `Message` row even exists (src/services/messages/
 * send-message.ts's sendMediaMessage() calls this first, since
 * `createPendingOutboundMessage` needs a real `mediaId` to point at).
 *
 * This is the "we keep our own copy regardless" half of architecture.md §8;
 * the "upload to the provider, get a reference back" half
 * (uploadStoredMediaToProvider, below) happens later, in the Worker, at
 * actual send time — not here — because it needs a live provider
 * connection (a Baileys socket) that the request-handling process doesn't
 * hold.
 */
export async function storeOutboundMedia(
  organizationId: string,
  file: Buffer,
  mimeType: string,
  fileName: string | null,
): Promise<Media> {
  const storageKey = `media/${organizationId}/${randomUUID()}`;
  await putObject(storageKey, file, mimeType);
  return createMedia(organizationId, {
    storageKey,
    mimeType,
    fileName,
    sizeBytes: file.length,
  });
}

/**
 * Outbound media, step 2 of 2: reads OUR OWN stored copy back out and hands
 * it to `provider.uploadMedia()` (architecture.md §8 — "uploadMedia() is
 * called first... then sendMedia() references that ID"). Called from
 * src/worker/consumers/send-message.consumer.ts immediately before
 * `provider.sendMedia()`, every send attempt (including a retry) — a
 * repeat upload on retry is a real but minor inefficiency for Phase B
 * (Meta's own upload is idempotent-safe to repeat), not a correctness
 * issue, and deliberately simpler than trying to cache/reuse a
 * provider-side media id across attempts (see TODO-VERIFY.md's M6 section
 * for why that caching was considered and rejected for Phase A
 * specifically: Baileys' own uploadMedia() only keeps the buffer in an
 * in-memory map that a Worker restart would silently empty, which would
 * make a cached reference a stale, permanently-broken one instead of a
 * harmless one — always re-uploading fresh sidesteps that trap entirely).
 */
export async function uploadStoredMediaToProvider(
  channelId: string,
  media: Media,
): Promise<MediaReference> {
  const buffer = await getObjectBuffer(media.storageKey);
  return getWhatsAppProvider().uploadMedia(channelId, buffer, media.mimeType);
}
