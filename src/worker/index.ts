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
 * M4 adds `send-message` and `status-update` consumers alongside it; M6
 * adds `download-media`.
 *
 * Boot-time channel connect (added post-M6, once a real dedicated test
 * number entered the picture): every ACTIVE channel, across every
 * organization (the worker is one process serving the whole platform, not
 * scoped to a single tenant — architecture.md §3), gets `connect()`ed on
 * startup — see `connectActiveChannels()` below, exactly the one-line-ish
 * addition this comment used to say was deferred. A channel with no paired
 * session yet prints a scannable QR code to this process's own stdout (see
 * `src/providers/baileys/adapter.ts`'s `handleConnectionUpdate` — there is
 * no admin UI for this yet, that's M9 territory); a channel with a
 * previously-paired session (persisted via `session-store.ts`) resumes
 * silently, no QR needed. Use `npm run activate-channel` (`scripts/
 * activate-channel.ts`) to flip a seeded DISCONNECTED channel to ACTIVE
 * before starting the worker.
 */
import "dotenv/config";
import { env } from "@/config/env";
import { Worker, type Job } from "bullmq";
import { redisConnection, REDIS_KEY_PREFIX } from "@/queue/connection";
import {
  QUEUE_NAMES,
  type IngestInboundJobData,
  type SendMessageJobData,
  type StatusUpdateJobData,
  type DownloadMediaJobData,
} from "@/queue/queues";
import { processIngestInboundJob } from "@/worker/consumers/ingest-inbound.consumer";
import {
  markSendMessageJobExhausted,
  processSendMessageJob,
} from "@/worker/consumers/send-message.consumer";
import { processStatusUpdateJob } from "@/worker/consumers/status-update.consumer";
import { processDownloadMediaJob } from "@/worker/consumers/download-media.consumer";
import { listOrganizations } from "@/data/organizations";
import { listChannelsInOrg } from "@/data/channels";
import { getWhatsAppProvider } from "@/providers/factory";
import { startTemplateSyncScheduler, startStuckMessageReconciliationScheduler } from "@/worker/scheduler";
import { syncTemplatesForChannel } from "@/services/templates/sync";

function startIngestInboundWorker(): Worker<IngestInboundJobData> {
  const worker = new Worker<IngestInboundJobData>(
    QUEUE_NAMES.ingestInbound,
    async (job: Job<IngestInboundJobData>) => {
      await processIngestInboundJob(job.data);
    },
    { connection: redisConnection, prefix: REDIS_KEY_PREFIX },
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
    { connection: redisConnection, prefix: REDIS_KEY_PREFIX },
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

function startDownloadMediaWorker(): Worker<DownloadMediaJobData> {
  const worker = new Worker<DownloadMediaJobData>(
    QUEUE_NAMES.downloadMedia,
    async (job: Job<DownloadMediaJobData>) => {
      await processDownloadMediaJob(job.data);
    },
    { connection: redisConnection, prefix: REDIS_KEY_PREFIX },
  );

  worker.on("completed", (job) => {
    console.log(`[worker] download-media job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    // No special DB write on exhaustion, unlike send-message's
    // markSendMessageJobExhausted — there is no "media download
    // permanently failed" field on Message in context.md's schema, and
    // inventing one is out of this milestone's scope. Once every retry
    // (src/queue/queues.ts's downloadMediaQueue attempts) is exhausted,
    // this log line is the record of it — the message row simply keeps
    // rendering as its type placeholder with no media attached, same as
    // it does while a download is still in flight.
    console.error(`[worker] download-media job ${job?.id} failed:`, err);
  });

  return worker;
}

function startStatusUpdateWorker(): Worker<StatusUpdateJobData> {
  const worker = new Worker<StatusUpdateJobData>(
    QUEUE_NAMES.statusUpdate,
    async (job: Job<StatusUpdateJobData>) => {
      await processStatusUpdateJob(job.data);
    },
    { connection: redisConnection, prefix: REDIS_KEY_PREFIX },
  );

  worker.on("completed", (job) => {
    console.log(`[worker] status-update job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] status-update job ${job?.id} failed:`, err);
  });

  return worker;
}

/**
 * Connects every ACTIVE channel across every organization (data/organizations.ts's
 * `listOrganizations` — already documented there as "for future admin/ops
 * tooling", exactly this use). A channel that's DISCONNECTED or SUSPENDED
 * is left alone, same as always — this only ever touches channels an admin
 * explicitly marked ACTIVE (via `npm run activate-channel` today; a real
 * admin UI later, M9). Returns the channel ids `connect()` was called for,
 * so `main()` can `disconnect()` the same set on shutdown.
 */
async function connectActiveChannels(): Promise<string[]> {
  const provider = getWhatsAppProvider();
  const connectedChannelIds: string[] = [];

  const orgs = await listOrganizations();
  for (const org of orgs) {
    const channels = await listChannelsInOrg(org.id);
    for (const channel of channels) {
      if (channel.status !== "ACTIVE") continue;
      try {
        await provider.connect(channel);
        connectedChannelIds.push(channel.id);
        // "every 15 minutes and on channel connect" (implementation-plan.md's
        // M7 task list) — the periodic half lives in scheduler.ts; this is
        // the on-connect half. Best-effort: a sync failure must not be
        // treated as a connect failure.
        try {
          await syncTemplatesForChannel(channel.organizationId, channel.id);
        } catch (error) {
          console.error(`[worker] template sync on connect failed for channel ${channel.id}:`, error);
        }
      } catch (error) {
        console.error(`[worker] failed to connect channel ${channel.id}:`, error);
      }
    }
  }

  console.log(`[worker] connect() called for ${connectedChannelIds.length} ACTIVE channel(s)`);
  return connectedChannelIds;
}

async function main(): Promise<void> {
  console.log(`[worker] starting (WHATSAPP_PROVIDER=${env.WHATSAPP_PROVIDER})`);

  const ingestInboundWorker = startIngestInboundWorker();
  const sendMessageWorker = startSendMessageWorker();
  const statusUpdateWorker = startStatusUpdateWorker();
  const downloadMediaWorker = startDownloadMediaWorker();

  const connectedChannelIds = await connectActiveChannels();
  const templateSyncScheduler = startTemplateSyncScheduler();
  const stuckMessageScheduler = startStuckMessageReconciliationScheduler();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    const provider = getWhatsAppProvider();
    templateSyncScheduler.stop();
    stuckMessageScheduler.stop();
    await Promise.all([
      ingestInboundWorker.close(),
      sendMessageWorker.close(),
      statusUpdateWorker.close(),
      downloadMediaWorker.close(),
      ...connectedChannelIds.map((id) => provider.disconnect(id)),
    ]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log(
    "[worker] ready — ingest-inbound, send-message, status-update, download-media consumers listening",
  );
}

main().catch((error: unknown) => {
  console.error("[worker] fatal startup error:", error);
  process.exitCode = 1;
});
