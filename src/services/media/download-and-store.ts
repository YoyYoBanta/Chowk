import { randomUUID } from "node:crypto";
import { getWhatsAppProvider } from "@/providers/factory";
import type { MediaReference } from "@/providers/types";
import { putObject } from "@/lib/storage/object-store";
import { createMedia } from "@/data/media";
import { getMessageById, linkMessageMedia } from "@/data/messages";
import { publishMessageUpdated } from "@/services/realtime/publish";
import { logger } from "@/lib/logging/logger";

export interface DownloadAndStoreMediaInput {
  organizationId: string;
  channelId: string;
  messageId: string;
  mediaRef: MediaReference;
  correlationId: string;
}

/**
 * The transport-agnostic inbound media pipeline (architecture.md §8 /
 * context.md §8.3): `provider.downloadMedia()` (whichever transport is
 * active) → our own object storage → a `Media` row → link
 * `Message.mediaId` → realtime notify, so an already-open thread swaps in
 * the real image/video/etc. without a manual refresh once it lands.
 *
 * Called from src/worker/consumers/download-media.consumer.ts, which is
 * enqueued from src/worker/consumers/ingest-inbound.consumer.ts in the
 * SAME TICK as the message insert (architecture.md §8: "not on-demand when
 * an agent opens the chat... Meta's media URLs are short-lived and a lazy
 * fetch risks permanent loss") — never lazily.
 *
 * Idempotent: a message that already has `mediaId` set is a redelivered
 * job (BullMQ at-least-once delivery), not a second download — skip
 * without writing anything, same guard shape as
 * ingest-inbound.consumer.ts's own providerMessageId dedupe check and
 * send-message.consumer.ts's "already past PENDING" guard.
 */
export async function downloadAndStoreMedia(input: DownloadAndStoreMediaInput): Promise<void> {
  const { organizationId, channelId, messageId, mediaRef, correlationId } = input;

  const message = await getMessageById(organizationId, messageId);
  if (!message) {
    // Shouldn't happen — messageId comes from a row the ingest-inbound
    // consumer just created moments earlier. Nothing a retry could fix.
    logger.error("download-and-store-media: message not found — dropping", {
      organizationId,
      correlationId,
      messageId,
    });
    return;
  }

  if (message.mediaId) {
    logger.info("download-and-store-media: message already has media — skipping (redelivered job)", {
      organizationId,
      correlationId,
      messageId,
    });
    return;
  }

  const buffer = await getWhatsAppProvider().downloadMedia(channelId, mediaRef);

  const storageKey = `media/${organizationId}/${randomUUID()}`;
  await putObject(storageKey, buffer, mediaRef.mimeType);

  const media = await createMedia(organizationId, {
    storageKey,
    mimeType: mediaRef.mimeType,
    fileName: mediaRef.filename ?? null,
    sizeBytes: buffer.length,
  });

  await linkMessageMedia(organizationId, messageId, media.id);

  logger.info("download-and-store-media: stored and linked", {
    organizationId,
    correlationId,
    messageId,
    mediaId: media.id,
    sizeBytes: buffer.length,
    mimeType: media.mimeType,
  });

  const updated = await getMessageById(organizationId, messageId);
  if (updated) {
    await publishMessageUpdated(organizationId, updated.conversationId, updated, { correlationId });
  }
}
