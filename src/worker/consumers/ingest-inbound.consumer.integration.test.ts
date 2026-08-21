import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import type { MediaReference, NormalizedInboundEvent } from "@/providers/types";
import { getDownloadMediaQueue } from "@/queue/queues";
import { processIngestInboundJob } from "./ingest-inbound.consumer";

/**
 * This is the milestone's real "done when" proof (context.md §11 M2 note):
 * "replaying the same event creates exactly one row" — plus the upsert and
 * UNSUPPORTED-fallback invariants architecture.md §6 lists alongside it.
 *
 * Runs the ACTUAL consumer (`processIngestInboundJob`, the exact function
 * `src/worker/index.ts`'s BullMQ Worker calls per job) against the real
 * Postgres database — no mocking of Prisma, same pattern as
 * tenancy-isolation.integration.test.ts. `NormalizedInboundEvent` objects
 * are constructed by hand here, exactly as a real Baileys socket would
 * produce them (see src/providers/baileys/normalize.ts for the real
 * mapping logic, unit-tested separately in normalize.test.ts) — standing
 * in for the live socket connection that can't be exercised without a
 * dedicated WhatsApp test number (TODO-VERIFY.md's M2 section). This
 * proves the entire pipeline below the transport for real: real Postgres,
 * real dedupe/upsert logic, the real data-access layer.
 *
 * Run with: npm run test:integration (see vitest.integration.config.ts).
 */

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeOrgWithChannel(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000000",
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
    from: "911234500000",
    contactName: "Test Contact",
    timestamp: new Date(),
    type: "TEXT",
    body: "hello",
    media: null,
    interactive: null,
    raw: { note: "synthetic event, not a live Baileys payload" },
    ...overrides,
  };
}

afterAll(async () => {
  // FK order: Message -> Conversation -> Contact/Channel -> Organization.
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("processIngestInboundJob (real Postgres, no mocking)", () => {
  it("replaying the same providerMessageId creates exactly one Message row", async () => {
    const { org, channel } = await makeOrgWithChannel("Dedupe Org");
    const providerMessageId = `dedupe-${suffix}-1`;
    const event = makeEvent(channel.id, { providerMessageId, from: `91100${suffix}` });

    await processIngestInboundJob({ organizationId: org.id, provider: "baileys", event });
    // Replay — must be a no-op, not a second row.
    await processIngestInboundJob({ organizationId: org.id, provider: "baileys", event });

    const messages = await prisma.message.findMany({
      where: { organizationId: org.id, providerMessageId },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      providerMessageId,
      provider: "baileys",
      direction: "INBOUND",
      type: "TEXT",
      body: "hello",
    });
  });

  it("two different events from a brand-new contact produce exactly one Contact and one Conversation", async () => {
    const { org, channel } = await makeOrgWithChannel("Upsert Org");
    const waId = `91200${suffix}`;

    const firstEvent = makeEvent(channel.id, {
      providerMessageId: `upsert-${suffix}-1`,
      from: waId,
    });
    const secondEvent = makeEvent(channel.id, {
      providerMessageId: `upsert-${suffix}-2`,
      from: waId,
      body: "second message",
    });

    await processIngestInboundJob({ organizationId: org.id, provider: "baileys", event: firstEvent });
    await processIngestInboundJob({ organizationId: org.id, provider: "baileys", event: secondEvent });

    const contacts = await prisma.contact.findMany({
      where: { organizationId: org.id, waId },
    });
    expect(contacts).toHaveLength(1);

    const conversations = await prisma.conversation.findMany({
      where: { organizationId: org.id, channelId: channel.id, contactId: contacts[0]!.id },
    });
    expect(conversations).toHaveLength(1);
    // Both inbound events landed against the same conversation, and each
    // bumped unreadCount (architecture.md §6: "set lastInboundAt,
    // lastMessageAt, unreadCount++").
    expect(conversations[0]!.unreadCount).toBe(2);

    const messages = await prisma.message.findMany({
      where: { organizationId: org.id, conversationId: conversations[0]!.id },
    });
    expect(messages).toHaveLength(2);
  });

  it("an UNSUPPORTED-typed event is stored with its raw payload preserved, and never throws", async () => {
    const { org, channel } = await makeOrgWithChannel("Unsupported Org");
    const providerMessageId = `unsupported-${suffix}-1`;
    const rawPayload = {
      pollCreationMessage: { name: "Pick one", options: [{ optionName: "A" }, { optionName: "B" }] },
      note: "a real message type our MessageType enum has no slot for",
    };

    const event = makeEvent(channel.id, {
      providerMessageId,
      from: `91300${suffix}`,
      type: "UNSUPPORTED",
      body: null,
      raw: rawPayload,
    });

    await expect(
      processIngestInboundJob({ organizationId: org.id, provider: "baileys", event }),
    ).resolves.not.toThrow();

    const message = await prisma.message.findFirst({
      where: { organizationId: org.id, providerMessageId },
    });
    expect(message).not.toBeNull();
    expect(message?.type).toBe("UNSUPPORTED");
    expect(message?.rawPayload).toEqual(rawPayload);
  });

  /**
   * M6 (architecture.md §8/§6): "enqueued in the SAME TICK as the message
   * insert" — this is the ingest side of that guarantee (the download
   * itself is covered for real in
   * src/services/media/download-and-store.integration.test.ts). Two things
   * this test pins down: the persisted Message's `mediaId` starts null (the
   * provider's own transient media reference is NOT mistaken for our
   * Media.id — see this file's own doc comment above the createMessage
   * call), and a real download-media BullMQ job lands with the exact
   * mediaRef the event carried.
   */
  it("an inbound event with media leaves mediaId null and enqueues a real download-media job", async () => {
    const { org, channel } = await makeOrgWithChannel("Media Org");
    const providerMessageId = `media-${suffix}-1`;
    const mediaRef: MediaReference = {
      id: "/v/xyz",
      mimeType: "image/jpeg",
      directPath: "/v/xyz",
      mediaKey: Buffer.from([9, 9, 9]).toString("base64"),
    };
    const event = makeEvent(channel.id, {
      providerMessageId,
      from: `91400${suffix}`,
      type: "IMAGE",
      body: "a photo",
      media: mediaRef,
    });

    await processIngestInboundJob({ organizationId: org.id, provider: "baileys", event });

    const message = await prisma.message.findFirst({ where: { organizationId: org.id, providerMessageId } });
    expect(message?.type).toBe("IMAGE");
    expect(message?.mediaId).toBeNull(); // not yet downloaded — see the doc comment above

    const queue = getDownloadMediaQueue();
    const waitingJobs = await queue.getJobs(["waiting", "active", "delayed"]);
    const job = waitingJobs.find((j) => j.data.messageId === message?.id);
    expect(job).toBeDefined();
    expect(job?.data).toMatchObject({
      organizationId: org.id,
      provider: "baileys",
      channelId: channel.id,
      messageId: message?.id,
      mediaRef,
    });
    await job?.remove();
  });
});
