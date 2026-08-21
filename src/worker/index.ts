/**
 * Worker process entrypoint (architecture.md §3 / §4: "Standalone Node
 * process... Yes — mandatory. Owns: BullMQ consumers, Baileys socket
 * (Phase A), scheduled jobs, all outbound-send execution"). Run with:
 *
 *   npm run worker
 *
 * (`tsx src/worker/index.ts` — same runner convention as `prisma/seed.ts`,
 * see package.json.)
 *
 * Loads `.env` itself via `dotenv/config` (must be the first import) —
 * unlike `prisma/seed.ts`, which gets `.env` loaded for it by
 * `prisma.config.ts` because it only ever runs through `prisma db seed`,
 * this file is invoked directly (`tsx src/worker/index.ts`, no Prisma CLI
 * in the chain), so nothing else would load it otherwise. Same pattern as
 * vitest.integration.config.ts.
 *
 * M2 scope: only the `ingest-inbound` consumer is wired up for real here.
 * M4 adds `send-message` and `status-update` consumers alongside it.
 *
 * Deliberately NOT done in M2 (still true at M4): auto-connecting every
 * ACTIVE channel's Baileys socket on boot. `src/providers/baileys/adapter.ts`'s
 * `connect()` is code-complete, but there is no dedicated WhatsApp test
 * number available yet (see TODO-VERIFY.md's M2 section) — having the
 * worker eagerly call `connect()` for a channel with no real session
 * behind it on every boot would just spin on reconnect attempts against
 * nothing. Wiring that boot-time loop back in is a one-line addition once
 * a real channel exists: list ACTIVE channels (across all orgs — the
 * worker is one process serving the whole platform, not scoped to a
 * single tenant) and call `getWhatsAppProvider().connect(channel)` for
 * each.
 */
import "dotenv/config";
import { env } from "@/config/env";
import { Worker, type Job } from "bullmq";
import { redisConnection } from "@/queue/connection";
import {
  QUEUE_NAMES,
  type IngestInboundJobData,
  type SendMessageJobData,
  type StatusUpdateJobData,
} from "@/queue/queues";
import { processIngestInboundJob } from "@/worker/consumers/ingest-inbound.consumer";
import {
  markSendMessageJobExhausted,
  processSendMessageJob,
} from "@/worker/consumers/send-message.consumer";
import { processStatusUpdateJob } from "@/worker/consumers/status-update.consumer";

function startIngestInboundWorker(): Worker<IngestInboundJobData> {
  const worker = new Worker<IngestInboundJobData>(
    QUEUE_NAMES.ingestInbound,
    async (job: Job<IngestInboundJobData>) => {
      await processIngestInboundJob(job.data);
    },
    { connection: redisConnection },
  );

  worker.on("completed", (job) => {
    console.log(`[worker] ingest-inbound job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] ingest-inbound job ${job?.id} failed:`, err);
  });

  return worker;
}

function startSendMessageWorker(): Worker<SendMessageJobData> {
  const worker = new Worker<SendMessageJobData>(
    QUEUE_NAMES.sendMessage,
    async (job: Job<SendMessageJobData>) => {
      await processSendMessageJob(job.data);
    },
    { connection: redisConnection },
  );

  worker.on("completed", (job) => {
    console.log(`[worker] send-message job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] send-message job ${job?.id} failed:`, err);
    // Once every configured retry attempt (src/queue/queues.ts's
    // defaultJobOptions) is exhausted, the message must not sit silently
    // PENDING forever (context.md rule 6) — see
    // markSendMessageJobExhausted's own doc comment for why this is safe
    // to call unconditionally on every failure (it no-ops once the
    // message has already moved past PENDING).
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void markSendMessageJobExhausted(job.data, err);
    }
  });

  return worker;
}

function startStatusUpdateWorker(): Worker<StatusUpdateJobData> {
  const worker = new Worker<StatusUpdateJobData>(
    QUEUE_NAMES.statusUpdate,
    async (job: Job<StatusUpdateJobData>) => {
      await processStatusUpdateJob(job.data);
    },
    { connection: redisConnection },
  );

  worker.on("completed", (job) => {
    console.log(`[worker] status-update job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] status-update job ${job?.id} failed:`, err);
  });

  return worker;
}

async function main(): Promise<void> {
  console.log(`[worker] starting (WHATSAPP_PROVIDER=${env.WHATSAPP_PROVIDER})`);

  const ingestInboundWorker = startIngestInboundWorker();
  const sendMessageWorker = startSendMessageWorker();
  const statusUpdateWorker = startStatusUpdateWorker();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    await Promise.all([
      ingestInboundWorker.close(),
      sendMessageWorker.close(),
      statusUpdateWorker.close(),
    ]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log(
    "[worker] ready — ingest-inbound, send-message, status-update consumers listening",
  );
}

main().catch((error: unknown) => {
  console.error("[worker] fatal startup error:", error);
  process.exitCode = 1;
});
