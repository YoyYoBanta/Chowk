import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Worker, QueueEvents } from "bullmq";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { redisConnection } from "@/queue/connection";
import { getIngestInboundQueue, QUEUE_NAMES, type IngestInboundJobData } from "@/queue/queues";
import { processIngestInboundJob } from "./consumers/ingest-inbound.consumer";
import type { NormalizedInboundEvent } from "@/providers/types";

/**
 * Companion to ingest-inbound.consumer.integration.test.ts, which exercises
 * `processIngestInboundJob` directly against real Postgres. This file goes
 * one layer further out and proves the REAL Redis/BullMQ queue end to end
 * (per the M2 task list's explicit instruction: "verify the entire
 * pipeline below the transport for real: real Redis, real BullMQ queue,
 * real Postgres... by constructing synthetic NormalizedInboundEvent
 * objects by hand... and pushing them through the actual queue into the
 * actual ingest-inbound consumer") — a real job is enqueued onto the real
 * `ingest-inbound` BullMQ queue, a real BullMQ `Worker` (the same
 * `processIngestInboundJob` function src/worker/index.ts wires up)
 * consumes it, and only then do we assert on the database.
 *
 * Requires a reachable Redis at REDIS_URL, same as `npm run test:integration`
 * requires reachable Postgres (see vitest.integration.config.ts).
 */

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeOrgWithChannel(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000001",
    provider: "baileys",
    status: "DISCONNECTED",
  });
  return { org, channel };
}

function makeEvent(
  channelId: string,
  overrides: Partial<NormalizedInboundEvent> & { providerMessageId: string },
): NormalizedInboundEvent {
  return {
    channelId,
    from: "911234500001",
    contactName: "Queue Test Contact",
    timestamp: new Date(),
    type: "TEXT",
    body: "hello via the real queue",
    media: null,
    interactive: null,
    raw: { note: "synthetic event pushed through the real BullMQ queue" },
    ...overrides,
  };
}

let worker: Worker<IngestInboundJobData> | undefined;
let queueEvents: QueueEvents | undefined;

afterAll(async () => {
  await worker?.close();
  await queueEvents?.close();
  await getIngestInboundQueue()
    .obliterate({ force: true })
    .catch(() => undefined);
  await getIngestInboundQueue().close();

  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });

  await prisma.$disconnect();
  await redisConnection.quit();
});

describe("ingest-inbound queue, end to end (real Redis + real BullMQ + real Postgres)", () => {
  it("a job pushed through the real queue is consumed and lands as exactly one Message row", async () => {
    worker = new Worker<IngestInboundJobData>(
      QUEUE_NAMES.ingestInbound,
      async (job) => {
        await processIngestInboundJob(job.data);
      },
      { connection: redisConnection },
    );
    queueEvents = new QueueEvents(QUEUE_NAMES.ingestInbound, { connection: redisConnection });
    await worker.waitUntilReady();
    await queueEvents.waitUntilReady();

    const { org, channel } = await makeOrgWithChannel("Queue E2E Org");
    const providerMessageId = `queue-e2e-${suffix}-1`;
    const event = makeEvent(channel.id, { providerMessageId, from: `91400${suffix}` });

    const job = await getIngestInboundQueue().add(QUEUE_NAMES.ingestInbound, {
      organizationId: org.id,
      provider: "baileys",
      event,
    });
    await job.waitUntilFinished(queueEvents, 15_000);

    const messages = await prisma.message.findMany({
      where: { organizationId: org.id, providerMessageId },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ providerMessageId, provider: "baileys", type: "TEXT" });

    // Replay through the real queue a second time — still exactly one row.
    const replayJob = await getIngestInboundQueue().add(QUEUE_NAMES.ingestInbound, {
      organizationId: org.id,
      provider: "baileys",
      event,
    });
    await replayJob.waitUntilFinished(queueEvents, 15_000);

    const messagesAfterReplay = await prisma.message.findMany({
      where: { organizationId: org.id, providerMessageId },
    });
    expect(messagesAfterReplay).toHaveLength(1);
  }, 30_000);
});
