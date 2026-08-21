import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { createUser } from "@/data/users";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import type { SendResult, SendTextParams, WhatsAppProvider } from "@/providers/types";
import { sendTextMessage } from "@/services/messages/send-message";
import { processSendMessageJob } from "./send-message.consumer";

/**
 * The milestone's real acceptance test for the send pipeline (context.md
 * §11 M4 / this milestone's brief): "sending via the test-double-provider
 * path produces a SENT message with a captured providerMessageId", plus
 * the retryable/terminal-failure branches and the crash-recovery ordering
 * proof, all against REAL Postgres — the sanctioned seam is mocking only
 * `src/providers/factory.ts`'s `getWhatsAppProvider()`, never Prisma, the
 * queue, or the consumer logic itself (this milestone's own instruction).
 *
 * `vi.hoisted` is required because `vi.mock` factories are hoisted above
 * all imports by Vitest's transform — the mutable `state` object below has
 * to be created inside `vi.hoisted` so the mock factory can close over it
 * safely (Vitest's own documented pattern for this).
 */
const { state } = vi.hoisted(() => ({
  state: {
    nextResult: { ok: true, providerMessageId: "unset" } as SendResult,
    /** When set, sendText THROWS instead of returning nextResult at all —
     * the "provider call itself throws" case the crash-recovery test needs. */
    throwOnSend: false,
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
      if (state.throwOnSend) {
        throw new Error("provider call threw unexpectedly");
      }
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

async function makeFixture(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000000",
    provider: "baileys",
    status: "ACTIVE",
  });
  const user = await createUser(org.id, {
    email: `agent-${label}-${suffix}@test.chowk`.toLowerCase(),
    passwordHash: "not-a-real-hash",
    name: "Test Agent",
  });
  const contact = await upsertContact(org.id, { waId: `9199${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  return { org, channel, user, contact, conversation };
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
  state.throwOnSend = false;
});

describe("send pipeline: send-message.ts -> processSendMessageJob (real Postgres, mocked factory only)", () => {
  it("success: SENT + providerMessageId captured", async () => {
    const { org, channel, contact, conversation, user } = await makeFixture("Success");
    state.nextResult = { ok: true, providerMessageId: `provider-msg-${suffix}` };

    const result = await sendTextMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      body: "hello there",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Step 2/3's ordering: the row already exists as PENDING, before the
    // job has been processed at all.
    const pending = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(pending?.status).toBe("PENDING");
    expect(pending?.direction).toBe("OUTBOUND");
    expect(pending?.body).toBe("hello there");

    await processSendMessageJob({ organizationId: org.id, messageId: result.message.id });

    const sent = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(sent?.status).toBe("SENT");
    expect(sent?.providerMessageId).toBe(`provider-msg-${suffix}`);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ channelId: channel.id, to: contact.waId, body: "hello there" });
  });

  it("terminal failure: FAILED + errorCode/errorMessage, never retried", async () => {
    const { org, conversation, user } = await makeFixture("Terminal");
    state.nextResult = {
      ok: false,
      retryable: false,
      code: "INVALID_RECIPIENT",
      message: "This number is not on WhatsApp.",
    };

    const result = await sendTextMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      body: "hello",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A terminal failure must resolve normally (no throw) — that's what
    // signals BullMQ "this job is done, do not retry it".
    await expect(
      processSendMessageJob({ organizationId: org.id, messageId: result.message.id }),
    ).resolves.toBeUndefined();

    const failed = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(failed?.status).toBe("FAILED");
    expect(failed?.errorCode).toBe("INVALID_RECIPIENT");
    expect(failed?.errorMessage).toBe("This number is not on WhatsApp.");
    expect(failed?.providerMessageId).toBeNull();
  });

  it("retryable failure: throws (handing control back to BullMQ), message stays PENDING — never prematurely FAILED", async () => {
    const { org, conversation, user } = await makeFixture("Retryable");
    state.nextResult = {
      ok: false,
      retryable: true,
      code: "RATE_LIMITED",
      message: "Too many requests, try again shortly.",
    };

    const result = await sendTextMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      body: "hello",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      processSendMessageJob({ organizationId: org.id, messageId: result.message.id }),
    ).rejects.toThrow(/RATE_LIMITED/);

    const stillPending = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(stillPending?.status).toBe("PENDING");
    expect(stillPending?.errorCode).toBeNull();
  });

  it("crash-recovery ordering: the PENDING row survives even when the provider call itself throws", async () => {
    const { org, conversation, user } = await makeFixture("Crash");

    const result = await sendTextMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      body: "hello",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const messageId = result.message.id;

    // Row exists as PENDING immediately after the service call returns —
    // strictly before any provider call has happened at all, since the
    // real provider call only ever happens later, in the job processed
    // below (a structurally different process/step in the real
    // architecture — see send-message.ts's own doc comment).
    const beforeSend = await prisma.message.findUnique({ where: { id: messageId } });
    expect(beforeSend).not.toBeNull();
    expect(beforeSend?.status).toBe("PENDING");

    // Now make the actual send THROW outright (not a well-formed
    // SendResult) — the "provider call... made to fail/throw" case this
    // milestone's brief asks for explicitly — and process the job for real.
    state.throwOnSend = true;

    await expect(
      processSendMessageJob({ organizationId: org.id, messageId }),
    ).rejects.toThrow("provider call threw unexpectedly");

    // The row must still exist — recoverable, not lost — and still
    // PENDING, since only a well-formed terminal SendResult ever moves a
    // message to FAILED; an uncaught throw propagates the same way a
    // retryable failure does (recoverable via BullMQ's own retry), never
    // silently losing the row.
    const afterThrow = await prisma.message.findUnique({ where: { id: messageId } });
    expect(afterThrow).not.toBeNull();
    expect(afterThrow?.status).toBe("PENDING");
  });
});
