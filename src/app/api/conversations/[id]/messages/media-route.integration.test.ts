import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { SESSION_COOKIE_NAME, sealSessionCookie } from "@/lib/auth/session";
import type { SendResult, WhatsAppProvider } from "@/providers/types";
import { POST } from "./route";

/**
 * M6's actual "an image sent from the UI arrives" done-criterion, one
 * layer up from send-message.media.integration.test.ts's direct service
 * call: a REAL HTTP POST with a real `multipart/form-data` body (a real
 * `File`, not a mocked Request) through the real exported route handler,
 * proving the Content-Type dispatch in src/app/api/conversations/[id]/
 * messages/route.ts actually parses it — mirroring the precedent
 * send-message.window.integration.test.ts already set for testing the
 * route handler directly, not just the service function.
 */
vi.mock("@/lib/storage/object-store", () => ({
  putObject: async () => {},
  getObjectBuffer: async () => Buffer.from(""),
}));

vi.mock("@/providers/factory", () => ({
  getWhatsAppProvider: (): WhatsAppProvider => ({
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    getConnectionState: async () => ({ status: "connected" as const }),
    sendText: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }) as SendResult,
    sendMedia: async () => ({ ok: true, providerMessageId: "provider-msg-media-route" }) as SendResult,
    sendTemplate: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }) as SendResult,
    markAsRead: async () => {},
    downloadMedia: async () => Buffer.from(""),
    uploadMedia: async () => ({ id: "provider-media-x", mimeType: "image/png" }),
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

async function makeFixture(lastInboundAt: Date) {
  const org = await createOrganization(`MediaRoute ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: "media route channel",
    phoneNumber: "10000000011",
    provider: "baileys",
    status: "ACTIVE",
  });
  const contact = await upsertContact(org.id, { waId: `9199${suffix}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: lastInboundAt,
  });
  return { org, channel, contact, conversation };
}

async function cookieHeaderFor(organizationId: string): Promise<string> {
  const sealed = await sealSessionCookie({
    userId: `user_${randomUUID().slice(0, 8)}`,
    organizationId,
    role: "AGENT",
  });
  return `${SESSION_COOKIE_NAME}=${sealed}`;
}

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.media.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("POST /api/conversations/:id/messages — multipart media send (real HTTP request)", () => {
  it("accepts a real multipart/form-data request and returns 202 with a media summary", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { org, conversation } = await makeFixture(oneHourAgo);
    const cookie = await cookieHeaderFor(org.id);

    const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.png", { type: "image/png" });
    const form = new FormData();
    form.append("file", file);
    form.append("caption", "sent from a real multipart request");

    const request = new NextRequest(`http://localhost/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });

    const res = await POST(request, { params: Promise.resolve({ id: conversation.id }) });
    expect(res.status).toBe(202);

    const body = (await res.json()) as { message: { id: string; type: string; body: string; media: { id: string; url: string } | null } };
    expect(body.message.type).toBe("IMAGE");
    expect(body.message.body).toBe("sent from a real multipart request");
    expect(body.message.media).not.toBeNull();
    expect(body.message.media?.url).toBe(`/api/media/${body.message.media?.id}`);

    const stored = await prisma.message.findUnique({ where: { id: body.message.id } });
    expect(stored?.mediaId).toBeTruthy();
  });

  it("returns 400 when the multipart request has no file field", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { org, conversation } = await makeFixture(oneHourAgo);
    const cookie = await cookieHeaderFor(org.id);

    const form = new FormData();
    form.append("caption", "no file attached");

    const request = new NextRequest(`http://localhost/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });

    const res = await POST(request, { params: Promise.resolve({ id: conversation.id }) });
    expect(res.status).toBe(400);
  });
});
