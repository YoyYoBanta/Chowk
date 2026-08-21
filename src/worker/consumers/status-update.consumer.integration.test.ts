import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import type { NormalizedStatusEvent } from "@/providers/types";
import type { StatusUpdateJobData } from "@/queue/queues";
import { processStatusUpdateJob } from "./status-update.consumer";

/**
 * This milestone's named correctness-bug hotspot (context.md §13 /
 * architecture.md §10): forward-only status progression, exercised here
 * against the REAL consumer + REAL Postgres by feeding hand-constructed
 * `NormalizedStatusEvent`s (synthetic, same pattern M2/M3 used for inbound
 * events — no live phone needed) through `processStatusUpdateJob` directly,
 * in deliberately out-of-order sequences.
 */
const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeFixture(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000000",
    provider: "baileys",
    status: "ACTIVE",
  });
  const contact = await upsertContact(org.id, { waId: `9198${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  return { org, channel, contact, conversation };
}

/** A previously-"sent" outbound Message row — providerMessageId already
 * persisted, exactly the state send-message.consumer.ts leaves behind on
 * success, which is the only state from which a status-update job can ever
 * find this message at all (see status-update.consumer.ts's doc comment). */
async function makeSentMessage(organizationId: string, conversationId: string, providerMessageId: string) {
  return prisma.message.create({
    data: {
      organizationId,
      conversationId,
      provider: "baileys",
      providerMessageId,
      direction: "OUTBOUND",
      type: "TEXT",
      body: "hi",
      status: "SENT",
      metaTimestamp: new Date(),
    },
  });
}

function makeJob(
  organizationId: string,
  overrides: Partial<NormalizedStatusEvent> & { providerMessageId: string },
): StatusUpdateJobData {
  return {
    organizationId,
    provider: "baileys",
    event: {
      channelId: "unused-in-this-test",
      status: "DELIVERED",
      timestamp: new Date(),
      ...overrides,
    },
  };
}

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("processStatusUpdateJob (real Postgres, no mocking)", () => {
  it("applies the normal forward progression SENT -> DELIVERED -> READ", async () => {
    const { org, conversation } = await makeFixture("Forward");
    const providerMessageId = `pmid-forward-${suffix}`;
    await makeSentMessage(org.id, conversation.id, providerMessageId); // starts at SENT

    await processStatusUpdateJob(makeJob(org.id, { providerMessageId, status: "DELIVERED" }));
    let row = await prisma.message.findFirst({ where: { organizationId: org.id, providerMessageId } });
    expect(row?.status).toBe("DELIVERED");

    await processStatusUpdateJob(makeJob(org.id, { providerMessageId, status: "READ" }));
    row = await prisma.message.findFirst({ where: { organizationId: org.id, providerMessageId } });
    expect(row?.status).toBe("READ");
  });

  it("ignores a SENT arriving after the message is already READ — row stays READ", async () => {
    const { org, conversation } = await makeFixture("StaleAfterRead");
    const providerMessageId = `pmid-stale-${suffix}`;
    await makeSentMessage(org.id, conversation.id, providerMessageId);

    await processStatusUpdateJob(makeJob(org.id, { providerMessageId, status: "READ" }));
    let row = await prisma.message.findFirst({ where: { organizationId: org.id, providerMessageId } });
    expect(row?.status).toBe("READ");

    // Out-of-order/stale SENT arrives after READ — must be ignored, not
    // regress the row (architecture.md §10: "this IS the correct behavior,
    // not a bug").
    await processStatusUpdateJob(makeJob(org.id, { providerMessageId, status: "SENT" }));
    row = await prisma.message.findFirst({ where: { organizationId: org.id, providerMessageId } });
    expect(row?.status).toBe("READ");
  });

  it("applies a FAILED arriving after SENT — FAILED is terminal from any non-terminal state", async () => {
    const { org, conversation } = await makeFixture("FailedAfterSent");
    const providerMessageId = `pmid-failed-${suffix}`;
    await makeSentMessage(org.id, conversation.id, providerMessageId); // status: SENT

    await processStatusUpdateJob(
      makeJob(org.id, {
        providerMessageId,
        status: "FAILED",
        errorCode: "SOME_LATE_FAILURE",
        errorMessage: "Delivery failed after initial send.",
      }),
    );

    const row = await prisma.message.findFirst({ where: { organizationId: org.id, providerMessageId } });
    expect(row?.status).toBe("FAILED");
    expect(row?.errorCode).toBe("SOME_LATE_FAILURE");
    expect(row?.errorMessage).toBe("Delivery failed after initial send.");

    // And FAILED itself is terminal: nothing moves past it afterward.
    await processStatusUpdateJob(makeJob(org.id, { providerMessageId, status: "READ" }));
    const stillFailed = await prisma.message.findFirst({
      where: { organizationId: org.id, providerMessageId },
    });
    expect(stillFailed?.status).toBe("FAILED");
  });

  it("logs and drops a status update for a providerMessageId that doesn't exist yet — never throws", async () => {
    const { org } = await makeFixture("NotFound");
    await expect(
      processStatusUpdateJob(
        makeJob(org.id, { providerMessageId: `no-such-message-${suffix}`, status: "DELIVERED" }),
      ),
    ).resolves.toBeUndefined();
  });

  it("scopes the lookup by provider — a matching providerMessageId under a different provider string is not found", async () => {
    const { org, conversation } = await makeFixture("ProviderScoped");
    const providerMessageId = `pmid-scoped-${suffix}`;
    await makeSentMessage(org.id, conversation.id, providerMessageId);

    // Same id, but the job claims a different provider — must not match.
    await processStatusUpdateJob({
      organizationId: org.id,
      provider: "cloud-api",
      event: {
        channelId: "unused",
        providerMessageId,
        status: "READ",
        timestamp: new Date(),
      },
    });

    const row = await prisma.message.findFirst({ where: { organizationId: org.id, providerMessageId } });
    expect(row?.status).toBe("SENT"); // unchanged — the cloud-api-scoped lookup found nothing
  });
});
