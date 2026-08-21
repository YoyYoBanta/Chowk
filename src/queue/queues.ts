import { Queue } from "bullmq";
import { redisConnection } from "./connection";
import type { MediaReference, NormalizedInboundEvent, NormalizedStatusEvent } from "@/providers/types";

/** Queue name constants — the single source of truth both the producer
 * (provider adapters) and consumer (src/worker/consumers/) sides reference. */
export const QUEUE_NAMES = {
  ingestInbound: "ingest-inbound",
  sendMessage: "send-message",
  statusUpdate: "status-update",
  downloadMedia: "download-media",
} as const;

/**
 * Job payload for the ingest-inbound queue. This wraps
 * `NormalizedInboundEvent` (src/providers/types.ts) rather than extending
 * it, deliberately — the interface given in context.md §8.0.2 carries only
 * `channelId`, not `organizationId`, and that shape is not ours to change.
 * `organizationId` and `provider` are added here at the queue-payload
 * level instead, supplied by whichever adapter enqueues the job — it
 * already holds the full `Channel` row (organizationId included) from its
 * own `connect(channel)` call, so this costs no extra lookup. This is what
 * lets src/data/*.ts stay strictly organizationId-first with zero
 * exceptions: the consumer receives organizationId directly, it never has
 * to resolve it from channelId via an unscoped query.
 */
export interface IngestInboundJobData {
  organizationId: string;
  provider: "baileys" | "cloud-api";
  event: NormalizedInboundEvent;
}

let ingestInboundQueue: Queue<IngestInboundJobData> | undefined;

/**
 * Lazily constructs (and memoizes) the BullMQ Queue on first use, rather
 * than at module load. BullMQ's `Queue` constructor kicks off a
 * `waitUntilReady()` against Redis immediately — harmless in the worker
 * process where Redis is genuinely running, but src/providers/factory.ts
 * (and, transitively, this module) is also imported by the fast Vitest
 * suite to prove the cloud-api stub is selectable (vitest.config.ts runs
 * with no Redis reachable, by design). Deferring construction to first
 * call means a bare `import` of factory.ts/the Baileys adapter never
 * touches the network — only an actual `connect()`/enqueue does.
 */
export function getIngestInboundQueue(): Queue<IngestInboundJobData> {
  if (!ingestInboundQueue) {
    ingestInboundQueue = new Queue<IngestInboundJobData>(QUEUE_NAMES.ingestInbound, {
      connection: redisConnection,
    });
  }
  return ingestInboundQueue;
}

/**
 * M4 additions below: `send-message` and `status-update` (architecture.md
 * §13's queue table). Same lazy-construction pattern as ingestInboundQueue
 * above, for the identical reason — this module is reachable from the fast
 * Vitest suite's module graph, which must do zero network I/O on import.
 */

/**
 * Job payload for the send-message queue: only the message's id
 * (architecture.md §7/§13 — "never carries the payload itself, so retries
 * always read current DB state"), plus `organizationId` so the consumer's
 * DB lookup can stay organizationId-first with zero exceptions — the exact
 * same precedent `IngestInboundJobData` set (see its doc comment above):
 * the caller that enqueues (src/services/messages/send-message.ts) already
 * has `organizationId` in hand from the authenticated request, so this
 * costs no extra lookup and means the consumer never has to resolve
 * organizationId from a bare messageId via an unscoped query.
 */
export interface SendMessageJobData {
  organizationId: string;
  messageId: string;
}

let sendMessageQueue: Queue<SendMessageJobData> | undefined;

export function getSendMessageQueue(): Queue<SendMessageJobData> {
  if (!sendMessageQueue) {
    sendMessageQueue = new Queue<SendMessageJobData>(QUEUE_NAMES.sendMessage, {
      connection: redisConnection,
      defaultJobOptions: {
        // Exponential backoff for retryable send failures (architecture.md
        // §7/§13: "let BullMQ retry with exponential backoff... configure
        // this on the queue/job, not by manually re-enqueueing"). The
        // send-message consumer only ever THROWS for a retryable
        // `SendResult` — a terminal one resolves normally (job "succeeds"
        // from BullMQ's point of view, having already written FAILED to
        // the DB itself), so this config only ever engages for genuinely
        // retryable failures.
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
      },
    });
  }
  return sendMessageQueue;
}

/**
 * Job payload for the status-update queue: wraps `NormalizedStatusEvent`
 * (src/providers/types.ts) the same way `IngestInboundJobData` wraps
 * `NormalizedInboundEvent` — that interface shape isn't ours to change
 * (context.md §8.0.2), so `organizationId` and `provider` are added here at
 * the queue-payload level, supplied by the adapter from the `Channel` row
 * it already holds. Judgment call, flagged in TODO-VERIFY.md: this mirrors
 * the exact precedent `IngestInboundJobData` set at M2 for the identical
 * reason (keep src/data/*.ts organizationId-first with zero "resolve org
 * from a bare id" exceptions).
 */
export interface StatusUpdateJobData {
  organizationId: string;
  provider: "baileys" | "cloud-api";
  event: NormalizedStatusEvent;
}

let statusUpdateQueue: Queue<StatusUpdateJobData> | undefined;

export function getStatusUpdateQueue(): Queue<StatusUpdateJobData> {
  if (!statusUpdateQueue) {
    statusUpdateQueue = new Queue<StatusUpdateJobData>(QUEUE_NAMES.statusUpdate, {
      connection: redisConnection,
      defaultJobOptions: {
        // Bounded retry only (architecture.md §10: "a short retry is
        // acceptable, infinite retry is not") — covers the narrow, real
        // race where a status event arrives before send-message.consumer.ts
        // has finished persisting providerMessageId, without retrying
        // forever on a message that will never exist under this id.
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
      },
    });
  }
  return statusUpdateQueue;
}

/**
 * M6 addition: `download-media` (architecture.md §8/§13 — "enqueued in the
 * SAME TICK as the message insert... Time-sensitive, retried aggressively
 * before URL expiry (Phase B)"). Payload carries the full `MediaReference`
 * rather than just an id, unlike send-message/status-update's id-only
 * payloads — there is no durable row to re-read it from yet (that's the
 * whole point of this job: to CREATE that row), so the reference itself
 * has to travel with the job, exactly the way `IngestInboundJobData`
 * already carries a full `NormalizedInboundEvent` for the identical reason.
 */
export interface DownloadMediaJobData {
  organizationId: string;
  provider: "baileys" | "cloud-api";
  channelId: string;
  messageId: string;
  mediaRef: MediaReference;
}

let downloadMediaQueue: Queue<DownloadMediaJobData> | undefined;

export function getDownloadMediaQueue(): Queue<DownloadMediaJobData> {
  if (!downloadMediaQueue) {
    downloadMediaQueue = new Queue<DownloadMediaJobData>(QUEUE_NAMES.downloadMedia, {
      connection: redisConnection,
      defaultJobOptions: {
        // Tighter/faster than send-message's or status-update's backoff —
        // Meta's media download URLs are short-lived (context.md §4.4), so
        // a stuck download job should exhaust its retries quickly rather
        // than slowly, while there's still a chance the URL hasn't expired.
        attempts: 8,
        backoff: { type: "exponential", delay: 1_000 },
      },
    });
  }
  return downloadMediaQueue;
}
