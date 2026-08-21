import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { createUser } from "@/data/users";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { SESSION_COOKIE_NAME, sealSessionCookie } from "@/lib/auth/session";
import type { SendResult, SendTextParams, WhatsAppProvider } from "@/providers/types";
import { sendTextMessage } from "./send-message";
import { processSendMessageJob } from "@/worker/consumers/send-message.consumer";
import { POST as sendMessagePOST } from "@/app/api/conversations/[id]/messages/route";

/**
 * This milestone's actual, literal, done-criterion (context.md §11 M5):
 * "with a conversation whose last inbound is over 24 hours old... a direct
 * API call bypassing the UI is rejected with a structured error" — and,
 * critically, that rejection must leave zero Message rows behind (a
 * window-closed send is not a failed send, it's a send that never
 * happened — src/services/messages/send-message.ts's own doc comment).
 *
 * Covers both the milestone's explicit verification bullets:
 *  - a direct call to `sendTextMessage()` against a closed-window
 *    conversation is rejected (409/WINDOW_CLOSED) with no row created;
 *  - the exact same thing through a REAL HTTP request to the exported
 *    route handler (not just the service function), proving the API layer
 *    itself enforces this and not just something a UI could route around;
 *  - a conversation whose window is open sends successfully, using the
 *    same mocked-factory test-double-provider seam
 *    send-message.consumer.integration.test.ts already established (only
 *    src/providers/factory.ts's getWhatsAppProvider() is mocked — never
 *    Prisma, the queue, or the consumer logic itself).
 *
 * Real Postgres throughout — no Prisma mocking.
 */
const { state } = vi.hoisted(() => ({
  state: {
    nextResult: { ok: true, providerMessageId: "unset" } as SendResult,
    calls: [] as SendTextParams[],
  },
}));

vi.mock("@/providers/factory", () => ({
  getWhatsAppProvider: (): WhatsAppProvider => ({
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    getConnectionState: async () => ({ status: "connected" as const }),
    sendText: async (p: SendTextParams) => {
      state.calls.push(p);
      return state.nextResult;
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

async function makeFixture(label: string, lastInboundAt: Date) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000005",
    provider: "baileys",
    status: "ACTIVE",
  });
  const user = await createUser(org.id, {
    email: `agent-${label}-${suffix}@test.chowk`.toLowerCase(),
    passwordHash: "not-a-real-hash",
    name: "Test Agent",
  });
  const contact = await upsertContact(org.id, { waId: `9166${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: lastInboundAt,
  });
  return { org, channel, user, contact, conversation };
}

async function countMessagesFor(conversationId: string): Promise<number> {
  return prisma.message.count({ where: { conversationId } });
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
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  state.calls = [];
});

describe("24h window enforcement in the send pipeline (real Postgres, mocked factory only)", () => {
  it("sendTextMessage() rejects a closed-window conversation with 409/WINDOW_CLOSED and creates zero Message rows", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { org, user, conversation } = await makeFixture("SvcClosed", twentyFiveHoursAgo);

    const before = await countMessagesFor(conversation.id);
    expect(before).toBe(0);

    const result = await sendTextMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      body: "hello outside the window",
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: "WINDOW_CLOSED",
      error: expect.any(String),
    });

    // The actual point: no Message row was created at all as a result of
    // the rejected attempt — a window-closed send never happened, it isn't
    // a failed send.
    const after = await countMessagesFor(conversation.id);
    expect(after).toBe(0);
    expect(state.calls).toHaveLength(0); // the provider was never even invoked
  });

  it("a real HTTP POST to the route handler is rejected the same way, with the structured 409 body, and creates zero Message rows", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { org, conversation } = await makeFixture("RouteClosed", twentyFiveHoursAgo);
    const cookie = await cookieHeaderFor(org.id);

    const before = await countMessagesFor(conversation.id);
    expect(before).toBe(0);

    const request = new NextRequest(`http://localhost/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "a direct API call bypassing the UI" }),
    });

    const res = await sendMessagePOST(request, { params: Promise.resolve({ id: conversation.id }) });

    expect(res.status).toBe(409);
    const responseBody = (await res.json()) as { error: string; code?: string };
    expect(responseBody.code).toBe("WINDOW_CLOSED");
    expect(typeof responseBody.error).toBe("string");

    const after = await countMessagesFor(conversation.id);
    expect(after).toBe(0);
  });

  it("sends successfully end-to-end when the window is open (mocked test-double provider)", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { org, channel, user, contact, conversation } = await makeFixture("SvcOpen", oneHourAgo);
    state.nextResult = { ok: true, providerMessageId: `provider-msg-${suffix}` };

    const result = await sendTextMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      body: "hello inside the window",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pending = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(pending?.status).toBe("PENDING");

    await processSendMessageJob({ organizationId: org.id, messageId: result.message.id });

    const sent = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(sent?.status).toBe("SENT");
    expect(sent?.providerMessageId).toBe(`provider-msg-${suffix}`);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ channelId: channel.id, to: contact.waId });
  });

  it("skipWindowCheck bypasses the check even for a closed-window conversation (the future template-send seam)", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { org, user, conversation } = await makeFixture("SkipCheck", twentyFiveHoursAgo);
    state.nextResult = { ok: true, providerMessageId: `provider-msg-skip-${suffix}` };

    const result = await sendTextMessage(
      {
        organizationId: org.id,
        conversationId: conversation.id,
        userId: user.id,
        body: "sent via a hypothetical future template path",
      },
      { skipWindowCheck: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pending = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(pending?.status).toBe("PENDING");
  });
});
