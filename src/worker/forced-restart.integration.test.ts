import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Worker, Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { createUser } from "@/data/users";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { createPendingOutboundMessage } from "@/data/messages";
import { redisConnection, REDIS_KEY_PREFIX } from "@/queue/connection";
import { getWhatsAppProvider } from "@/providers/factory";
import type { SendMessageJobData } from "@/queue/queues";
import { processSendMessageJob } from "./consumers/send-message.consumer";
import type { SendResult, SendTextParams, WhatsAppProvider } from "@/providers/types";

/**
 * implementation-plan.md's M9 explicit acceptance criterion: "deliberately
 * kill the Worker process mid-queue during a load test and confirm no
 * message is lost or duplicated." A real BullMQ `Worker` (same shape as
 * `ingest-inbound-pipeline.integration.test.ts` already established for a
 * different queue) processes a job that HANGS mid-send, gets force-closed
 * before it can finish (simulating a crashed Worker process), and a second
 * Worker instance — standing in for the restarted process — picks the
 * stalled job back up. The DB-state-driven idempotency guard already built
 * into `processSendMessageJob` (`message.status !== "PENDING" -> skip`) is
 * what makes this safe: the row this test cares about ends in exactly one
 * definitive state (SENT), never duplicated, never lost.
 *
 * Deliberately uses its OWN dedicated queue name, not `getSendMessageQueue()`
 * — this codebase's real `send-message` queue can (and, in normal
 * development, does) have a genuine `npm run worker` process listening on
 * it at the same time tests run. That process would race this test's own
 * Worker A/B for the exact same job using the REAL, un-mocked provider,
 * which is a real, previously-hit source of flakiness (the same class of
 * interference `ingest-inbound.consumer.integration.test.ts` already
 * documents defensively for a different queue). Driving `processSendMessageJob`
 * — which only depends on `{ organizationId, messageId }`, never which
 * queue delivered it — through a private queue sidesteps that entirely,
 * with no need to stop any other process to run this reliably.
 */
const TEST_QUEUE_NAME = `send-message-forced-restart-test-${randomUUID().slice(0, 8)}`;

const { state } = vi.hoisted(() => ({
  state: {
    hangForever: false,
    calls: [] as SendTextParams[],
  },
}));

vi.mock("@/providers/factory", () => ({
  getWhatsAppProvider: (): WhatsAppProvider => ({
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    getConnectionState: async () => ({ status: "connected" as const }),
    sendText: async (p: SendTextParams): Promise<SendResult> => {
      state.calls.push(p);
      if (state.hangForever) {
        // Simulates a Worker that crashed mid-send: this promise is never
        // allowed to resolve within the test's lifetime — the only way the
        // job "completes" is via a second Worker picking up the stall.
        await new Promise(() => {});
      }
      return { ok: true, providerMessageId: `provider-restart-${randomUUID().slice(0, 8)}` };
    },
    sendMedia: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }),
    sendTemplate: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }),
    markAsRead: async () => {},
    downloadMedia: async () => Buffer.from(""),
    uploadMedia: async () => ({ id: "x", mimeType: "text/plain" }),
    listTemplates: async () => [],
    createTemplate: async () => {
      throw new Error("n/a");
    },
    onInbound: () => {},
    onStatusUpdate: () => {},
  }),
}));

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];
let testQueue: Queue<SendMessageJobData> | undefined;
let workerA: Worker<SendMessageJobData> | undefined;
let workerB: Worker<SendMessageJobData> | undefined;

async function makeFixture(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000008",
    provider: "baileys",
    status: "ACTIVE",
  });
  const user = await createUser(org.id, {
    email: `agent-${label}-${suffix}@test.chowk`.toLowerCase(),
    passwordHash: "not-a-real-hash",
    name: "Test Agent",
  });
  const contact = await upsertContact(org.id, { waId: `9170${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  return { org, channel, user, contact, conversation };
}

beforeEach(() => {
  state.calls = [];
  state.hangForever = false;
});

afterAll(async () => {
  await workerA?.close(true);
  await workerB?.close();
  await testQueue?.obliterate({ force: true }).catch(() => undefined);
  await testQueue?.close();

  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });

  await prisma.$disconnect();
});

describe("forced Worker restart mid-queue (real Redis + real BullMQ + real Postgres, private queue)", () => {
  it("a job stalled by a hard Worker kill is picked up by a fresh Worker and the message ends SENT exactly once, never duplicated", async () => {
    const { org, channel, contact, conversation, user } = await makeFixture("Restart");

    // Private queue name, but still under the suite's own key prefix: with
    // BullMQ's default ("bull") this test's keys would land in the *dev*
    // keyspace on a shared or managed Redis, which is exactly what
    // REDIS_KEY_PREFIX exists to prevent. The name keeps it off the
    // application's queues; the prefix keeps it off another environment's.
    testQueue = new Queue<SendMessageJobData>(TEST_QUEUE_NAME, {
      connection: redisConnection,
      prefix: REDIS_KEY_PREFIX,
    });
    await testQueue.waitUntilReady();

    // Worker A: short lock so BullMQ detects the stall quickly, and a
    // matching stalledInterval so its own check loop actually runs in test
    // time rather than waiting out the (much longer) default.
    workerA = new Worker<SendMessageJobData>(
      TEST_QUEUE_NAME,
      async (job) => {
        await processSendMessageJob(job.data);
      },
      { connection: redisConnection, prefix: REDIS_KEY_PREFIX, lockDuration: 1000, stalledInterval: 500 },
    );
    await workerA.waitUntilReady();

    // Real PENDING-row creation (same as sendTextMessage would do), but
    // enqueued onto this test's own private queue instead of the real
    // send-message queue — see this file's own doc comment for why.
    state.hangForever = true;
    const message = await createPendingOutboundMessage(org.id, {
      conversationId: conversation.id,
      provider: getWhatsAppProvider().name,
      type: "TEXT",
      body: "sent right before a simulated crash",
      sentByUserId: user.id,
    });
    await testQueue.add(TEST_QUEUE_NAME, { organizationId: org.id, messageId: message.id });
    const messageId = message.id;

    // Wait until Worker A has genuinely picked the job up and is hung
    // inside the mocked sendText — not just enqueued.
    await vi.waitFor(() => expect(state.calls.length).toBeGreaterThanOrEqual(1), { timeout: 5_000 });

    const pendingDuringHang = await prisma.message.findUnique({ where: { id: messageId } });
    expect(pendingDuringHang?.status).toBe("PENDING");

    // The simulated crash: force-close Worker A WITHOUT letting the
    // in-flight job finish or its lock be released cleanly — this is what
    // makes BullMQ consider the job stalled once the (short) lock expires,
    // exactly the scenario a killed process leaves behind.
    await workerA.close(true);

    // Worker B stands in for the restarted process. A fresh send succeeds
    // immediately this time (state.hangForever only affected the first,
    // still-hanging call inside Worker A).
    state.hangForever = false;
    workerB = new Worker<SendMessageJobData>(
      TEST_QUEUE_NAME,
      async (job) => {
        await processSendMessageJob(job.data);
      },
      { connection: redisConnection, prefix: REDIS_KEY_PREFIX, lockDuration: 1000, stalledInterval: 500 },
    );
    await workerB.waitUntilReady();

    // Poll for the message to reach its final state rather than relying on
    // job.waitUntilFinished for the original (now-abandoned-then-stalled)
    // job promise, since Worker A's own promise for it never resolves.
    await vi.waitFor(
      async () => {
        const current = await prisma.message.findUnique({ where: { id: messageId } });
        expect(current?.status).toBe("SENT");
      },
      { timeout: 10_000, interval: 200 },
    );

    const final = await prisma.message.findMany({ where: { organizationId: org.id, conversationId: conversation.id } });
    // Exactly one Message row for this send — never duplicated by the
    // stall-and-redeliver — and it's the same row created before either
    // Worker ever ran.
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe(messageId);
    expect(final[0].status).toBe("SENT");
    expect(final[0].providerMessageId).not.toBeNull();

    // The provider was invoked at least twice (the hung call inside Worker
    // A, then the real one inside Worker B) — an accepted at-least-once
    // characteristic of any redelivery-based queue, not something this
    // test claims to eliminate. What matters, and is asserted above, is
    // that the DATABASE never ends up with more than one row or a
    // non-terminal status.
    expect(state.calls.length).toBeGreaterThanOrEqual(2);
    expect(state.calls.every((c) => c.channelId === channel.id && c.to === contact.waId)).toBe(true);
  }, 30_000);
});
