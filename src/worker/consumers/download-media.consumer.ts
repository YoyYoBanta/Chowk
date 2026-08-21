import type { DownloadMediaJobData } from "@/queue/queues";
import { downloadAndStoreMedia } from "@/services/media/download-and-store";
import { newCorrelationId } from "@/lib/logging/logger";

/**
 * Thin wrapper (architecture.md §4's split between src/worker/consumers/ —
 * "loads the job, calls the service" — and src/services/ — "the actual
 * logic"), same shape as send-message.consumer.ts wrapping
 * src/services/messages/send-message.ts. All the real inbound-media logic
 * lives in src/services/media/download-and-store.ts so it stays directly
 * unit/integration-testable without a BullMQ Job object.
 */
export async function processDownloadMediaJob(data: DownloadMediaJobData): Promise<void> {
  await downloadAndStoreMedia({
    organizationId: data.organizationId,
    channelId: data.channelId,
    messageId: data.messageId,
    mediaRef: data.mediaRef,
    correlationId: newCorrelationId(),
  });
}
