import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { createMessage } from "@/data/messages";
import type { MediaReference, SendResult, WhatsAppProvider } from "@/providers/types";
import { downloadAndStoreMedia } from "./download-and-store";

/**
 * M6's inbound media pipeline (architecture.md §8, context.md §8.3),
 * against real Postgres. Two seams are mocked, not Prisma:
 *  - src/providers/factory.ts's getWhatsAppProvider() — the same one
 *    sanctioned seam every prior milestone's send-pipeline integration
 *    tests already use (send-message.consumer.integration.test.ts,
 *    send-message.window.integration.test.ts).
 *  - src/lib/storage/object-store.ts — a SECOND seam, new to this
 *    milestone. There is no real S3-compatible object storage reachable in
 *    any environment this codebase has run in so far (no MinIO stood up —
 *    same category of gap as M2's "no dedicated WhatsApp test number", see
 *    TODO-VERIFY.md's M6 section). Mocking it here proves the pipeline's
 *    own logic (dedupe/idempotency, the Media row's fields, linking
 *    Message.mediaId, the realtime publish) for real against Postgres,
 *    while treating "does putObject() actually reach a real bucket" as the
 *    one thing that still needs human verification once MinIO is running.
 */
const { storageState } = vi.hoisted(() => ({
  storageState: { puts: [] as Array<{ key: string; body: Buffer; contentType: string }> },
}));

vi.mock("@/lib/storage/object-store", () => ({
  putObject: async (key: string, body: Buffer, contentType: string) => {
    storageState.puts.push({ key, body, contentType });
  },
}));

const { providerState } = vi.hoisted(() => ({
  providerState: { nextBuffer: Buffer.from("fake-image-bytes"), downloadCalls: 0 },
}));

vi.mock("@/providers/factory", () => ({
  getWhatsAppProvider: (): WhatsAppProvider => ({
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    getConnectionState: async () => ({ status: "connected" as const }),
    sendText: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }) as SendResult,
    sendMedia: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }) as SendResult,
    sendTemplate: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }) as SendResult,
    markAsRead: async () => {},
    downloadMedia: async (_channelId: string, _ref: MediaReference) => {
      providerState.downloadCalls += 1;
      return providerState.nextBuffer;
    },
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

async function makeFixture() {
  const org = await createOrganization(`DownloadMedia ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: "test channel",
    phoneNumber: "10000000009",
    provider: "baileys",
    status: "ACTIVE",
  });
  const contact = await upsertContact(org.id, { waId: `9177${suffix}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  const message = await createMessage(org.id, {
    conversationId: conversation.id,
    provider: "baileys",
    providerMessageId: `wamid-${randomUUID()}`,
    direction: "INBOUND",
    type: "IMAGE",
    body: null,
    metaTimestamp: new Date(),
  });
  return { org, channel, contact, conversation, message };
}

const mediaRef: MediaReference = {
  id: "/v/abc",
  mimeType: "image/jpeg",
  directPath: "/v/abc",
  mediaKey: Buffer.from([1, 2, 3]).toString("base64"),
  filename: "photo.jpg",
};

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.media.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  storageState.puts = [];
  providerState.downloadCalls = 0;
});

describe("downloadAndStoreMedia (real Postgres, mocked provider + object store)", () => {
  it("downloads, stores, creates a Media row, and links Message.mediaId", async () => {
    const { org, channel, message } = await makeFixture();

    await downloadAndStoreMedia({
      organizationId: org.id,
      channelId: channel.id,
      messageId: message.id,
      mediaRef,
      correlationId: "test-correlation",
    });

    const updated = await prisma.message.findUnique({ where: { id: message.id } });
    expect(updated?.mediaId).toBeTruthy();

    const media = await prisma.media.findUnique({ where: { id: updated!.mediaId! } });
    expect(media).toMatchObject({
      organizationId: org.id,
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      sizeBytes: Buffer.byteLength("fake-image-bytes"),
    });

    expect(storageState.puts).toHaveLength(1);
    expect(storageState.puts[0]?.contentType).toBe("image/jpeg");
    expect(providerState.downloadCalls).toBe(1);
  });

  it("is idempotent: a redelivered job for an already-linked message does not download or create a second Media row", async () => {
    const { org, channel, message } = await makeFixture();

    await downloadAndStoreMedia({
      organizationId: org.id,
      channelId: channel.id,
      messageId: message.id,
      mediaRef,
      correlationId: "first",
    });
    const afterFirst = await prisma.message.findUnique({ where: { id: message.id } });
    const mediaCountAfterFirst = await prisma.media.count({ where: { organizationId: org.id } });

    // Redelivered job — same messageId, same mediaRef.
    await downloadAndStoreMedia({
      organizationId: org.id,
      channelId: channel.id,
      messageId: message.id,
      mediaRef,
      correlationId: "redelivered",
    });

    const afterSecond = await prisma.message.findUnique({ where: { id: message.id } });
    const mediaCountAfterSecond = await prisma.media.count({ where: { organizationId: org.id } });

    expect(afterSecond?.mediaId).toBe(afterFirst?.mediaId);
    expect(mediaCountAfterSecond).toBe(mediaCountAfterFirst);
    expect(providerState.downloadCalls).toBe(1); // never re-downloaded
  });

  it("does nothing when the message no longer exists", async () => {
    const { org, channel } = await makeFixture();

    await downloadAndStoreMedia({
      organizationId: org.id,
      channelId: channel.id,
      messageId: "does-not-exist",
      mediaRef,
      correlationId: "missing-message",
    });

    expect(storageState.puts).toHaveLength(0);
    expect(providerState.downloadCalls).toBe(0);
  });
});
