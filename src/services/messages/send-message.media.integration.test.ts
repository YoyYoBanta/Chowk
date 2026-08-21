import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { createUser } from "@/data/users";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import type { MediaReference, SendMediaParams, SendResult, WhatsAppProvider } from "@/providers/types";
import { sendMediaMessage } from "./send-message";
import { processSendMessageJob } from "@/worker/consumers/send-message.consumer";

/**
 * M6's outbound media path, real Postgres, two mocked seams (same
 * reasoning as download-and-store.integration.test.ts — the object store
 * seam is new to this milestone, see TODO-VERIFY.md's M6 section):
 * src/providers/factory.ts and src/lib/storage/object-store.ts.
 */
const { storageState } = vi.hoisted(() => ({
  storageState: { puts: 0, gets: 0 },
}));

vi.mock("@/lib/storage/object-store", () => ({
  putObject: async () => {
    storageState.puts += 1;
  },
  getObjectBuffer: async () => {
    storageState.gets += 1;
    return Buffer.from("stored-bytes");
  },
}));

const { providerState } = vi.hoisted(() => ({
  providerState: {
    nextSendResult: { ok: true, providerMessageId: "unset" } as SendResult,
    uploadCalls: [] as Array<{ mimeType: string }>,
    sendMediaCalls: [] as SendMediaParams[],
  },
}));

vi.mock("@/providers/factory", () => ({
  getWhatsAppProvider: (): WhatsAppProvider => ({
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    getConnectionState: async () => ({ status: "connected" as const }),
    sendText: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }) as SendResult,
    sendMedia: async (p: SendMediaParams) => {
      providerState.sendMediaCalls.push(p);
      return providerState.nextSendResult;
    },
    sendTemplate: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }) as SendResult,
    markAsRead: async () => {},
    downloadMedia: async () => Buffer.from(""),
    uploadMedia: async (_channelId: string, _file: Buffer, mimeType: string): Promise<MediaReference> => {
      providerState.uploadCalls.push({ mimeType });
      return { id: `provider-media-${randomUUID()}`, mimeType };
    },
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

async function makeFixture(label: string, lastInboundAt: Date) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000010",
    provider: "baileys",
    status: "ACTIVE",
  });
  const user = await createUser(org.id, {
    email: `agent-${label}-${suffix}@test.chowk`.toLowerCase(),
    passwordHash: "not-a-real-hash",
    name: "Test Agent",
  });
  const contact = await upsertContact(org.id, { waId: `9188${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: lastInboundAt,
  });
  return { org, channel, user, contact, conversation };
}

const jpegBuffer = Buffer.from("fake-jpeg-bytes");

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.media.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  storageState.puts = 0;
  storageState.gets = 0;
  providerState.uploadCalls = [];
  providerState.sendMediaCalls = [];
});

describe("sendMediaMessage (real Postgres, mocked provider + object store)", () => {
  it("stores the file, creates a Media row, and a PENDING Message with mediaId + IMAGE type", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { org, user, conversation } = await makeFixture("MediaOpen", oneHourAgo);

    const result = await sendMediaMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      file: jpegBuffer,
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      caption: "a photo",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.type).toBe("IMAGE");
    expect(result.message.status).toBe("PENDING");
    expect(result.message.body).toBe("a photo");
    expect(result.message.mediaId).toBeTruthy();

    const media = await prisma.media.findUnique({ where: { id: result.message.mediaId! } });
    expect(media).toMatchObject({ mimeType: "image/jpeg", fileName: "photo.jpg", sizeBytes: jpegBuffer.length });
    expect(storageState.puts).toBe(1);
  });

  it("rejects with 409/WINDOW_CLOSED and stores nothing when the window is closed", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { org, user, conversation } = await makeFixture("MediaClosed", twentyFiveHoursAgo);

    const result = await sendMediaMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      file: jpegBuffer,
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
    });

    expect(result).toMatchObject({ ok: false, status: 409, code: "WINDOW_CLOSED" });
    expect(storageState.puts).toBe(0); // never stored — window check runs first
    const messageCount = await prisma.message.count({ where: { conversationId: conversation.id } });
    expect(messageCount).toBe(0);
  });

  it("rejects with 400/INVALID_MEDIA for an unsupported file type, storing nothing", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { org, user, conversation } = await makeFixture("MediaInvalid", oneHourAgo);

    const result = await sendMediaMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      file: Buffer.from("not really an exe"),
      mimeType: "application/x-msdownload",
      fileName: "virus.exe",
    });

    expect(result).toMatchObject({ ok: false, status: 400, code: "INVALID_MEDIA" });
    expect(storageState.puts).toBe(0);
    const messageCount = await prisma.message.count({ where: { conversationId: conversation.id } });
    expect(messageCount).toBe(0);
  });

  it("end to end through the worker: uploadMedia() then sendMedia() are called, message moves PENDING -> SENT", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { org, channel, user, contact, conversation } = await makeFixture("MediaSend", oneHourAgo);
    providerState.nextSendResult = { ok: true, providerMessageId: `provider-msg-${suffix}` };

    const result = await sendMediaMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      file: jpegBuffer,
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      caption: "look at this",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await processSendMessageJob({ organizationId: org.id, messageId: result.message.id });

    const sent = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(sent?.status).toBe("SENT");
    expect(sent?.providerMessageId).toBe(`provider-msg-${suffix}`);

    expect(storageState.gets).toBe(1); // read our own stored copy back out
    expect(providerState.uploadCalls).toEqual([{ mimeType: "image/jpeg" }]);
    expect(providerState.sendMediaCalls).toHaveLength(1);
    expect(providerState.sendMediaCalls[0]).toMatchObject({
      channelId: channel.id,
      to: contact.waId,
      caption: "look at this",
    });
  });
});
