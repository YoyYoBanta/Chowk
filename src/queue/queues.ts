import { Queue } from "bullmq";
import { redisConnection } from "./connection";
import type { NormalizedInboundEvent } from "@/providers/types";

/** Queue name constants — the single source of truth both the producer
 * (provider adapters) and consumer (src/worker/consumers/) sides reference. */
export const QUEUE_NAMES = {
  ingestInbound: "ingest-inbound",
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
