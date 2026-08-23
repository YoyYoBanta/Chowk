import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { createUser } from "@/data/users";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { createTemplate, updateTemplateStatus } from "@/data/templates";
import type { SendResult, SendTemplateParams, WhatsAppProvider } from "@/providers/types";
import { sendTemplateMessage } from "./send-message";
import { processSendMessageJob } from "@/worker/consumers/send-message.consumer";

/**
 * The template send path (M7) never had any test coverage — this is the
 * milestone's own "done when" for the send side: an approved template with
 * every variable supplied sends; a missing/unapproved/mismatched-variable
 * template is rejected with zero rows written, matching the same
 * "rejection creates nothing" discipline
 * send-message.window.integration.test.ts already proves for the window
 * check. Real Postgres throughout — only src/providers/factory.ts is
 * mocked, same sanctioned seam every other send-pipeline integration test
 * in this repo uses.
 */
const { state } = vi.hoisted(() => ({
  state: {
    nextResult: { ok: true, providerMessageId: "unset" } as SendResult,
    calls: [] as SendTemplateParams[],
  },
}));

vi.mock("@/providers/factory", () => ({
  getWhatsAppProvider: (): WhatsAppProvider => ({
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    getConnectionState: async () => ({ status: "connected" as const }),
    sendText: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }),
    sendMedia: async () => ({ ok: false, retryable: false, code: "NOT_IMPLEMENTED", message: "n/a" }),
    sendTemplate: async (p: SendTemplateParams) => {
      state.calls.push(p);
      return state.nextResult;
    },
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
    phoneNumber: "10000000006",
    provider: "baileys",
    status: "ACTIVE",
  });
  const user = await createUser(org.id, {
    email: `agent-${label}-${suffix}@test.chowk`.toLowerCase(),
    passwordHash: "not-a-real-hash",
    name: "Test Agent",
  });
  // lastInboundAt deliberately > 24h ago — templates bypass the window
  // check entirely (context.md §4.1), so a closed-window conversation is
  // the right fixture to prove that.
  const contact = await upsertContact(org.id, { waId: `9167${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
  });
  return { org, channel, user, contact, conversation };
}

async function countMessagesFor(conversationId: string): Promise<number> {
  return prisma.message.count({ where: { conversationId } });
}

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.template.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  state.calls = [];
});

describe("template send path (real Postgres, mocked factory only)", () => {
  it("rejects with 404 when the template doesn't exist for this channel/language", async () => {
    const { org, user, conversation } = await makeFixture("TplMissing");

    const result = await sendTemplateMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      templateName: "does_not_exist",
      languageCode: "en",
      variables: {},
    });

    expect(result).toEqual({ ok: false, status: 404, error: expect.any(String) });
    expect(await countMessagesFor(conversation.id)).toBe(0);
  });

  it("rejects with 409/TEMPLATE_NOT_APPROVED when the local template status isn't APPROVED", async () => {
    const { org, channel, user, conversation } = await makeFixture("TplPending");
    await createTemplate(org.id, channel.id, {
      name: "welcome",
      language: "en",
      category: "MARKETING",
      status: "PENDING",
      components: { body: "Hi {{1}}, welcome!" },
    });

    const result = await sendTemplateMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      templateName: "welcome",
      languageCode: "en",
      variables: { "1": "Asha" },
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      code: "TEMPLATE_NOT_APPROVED",
      error: expect.any(String),
    });
    expect(await countMessagesFor(conversation.id)).toBe(0);
  });

  it("rejects with 400/TEMPLATE_VARIABLE_MISMATCH when a required {{n}} placeholder has no value", async () => {
    const { org, channel, user, conversation } = await makeFixture("TplMismatch");
    await createTemplate(org.id, channel.id, {
      name: "order_update",
      language: "en",
      category: "UTILITY",
      status: "APPROVED",
      components: { body: "Hi {{1}}, your order {{2}} shipped." },
    });

    const result = await sendTemplateMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      templateName: "order_update",
      languageCode: "en",
      // {{2}} is missing entirely.
      variables: { "1": "Asha" },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "TEMPLATE_VARIABLE_MISMATCH",
      missing: ["2"],
    });
    expect(await countMessagesFor(conversation.id)).toBe(0);
    expect(state.calls).toHaveLength(0); // never even reached the Worker/provider
  });

  it("sends successfully end-to-end when APPROVED with every variable supplied, bypassing the closed window", async () => {
    const { org, channel, user, contact, conversation } = await makeFixture("TplSend");
    await createTemplate(org.id, channel.id, {
      name: "order_update",
      language: "en",
      category: "UTILITY",
      status: "APPROVED",
      components: { body: "Hi {{1}}, your order {{2}} shipped." },
    });
    state.nextResult = { ok: true, providerMessageId: `provider-tpl-${suffix}` };

    const result = await sendTemplateMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      templateName: "order_update",
      languageCode: "en",
      variables: { "1": "Asha", "2": "#4821" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pending = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(pending?.status).toBe("PENDING");
    expect(pending?.templateName).toBe("order_update");
    expect(pending?.templatePayload).toEqual({ languageCode: "en", variables: { "1": "Asha", "2": "#4821" } });

    await processSendMessageJob({ organizationId: org.id, messageId: result.message.id });

    const sent = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(sent?.status).toBe("SENT");
    expect(sent?.providerMessageId).toBe(`provider-tpl-${suffix}`);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      channelId: channel.id,
      to: contact.waId,
      templateName: "order_update",
      languageCode: "en",
      variables: { "1": "Asha", "2": "#4821" },
    });
  });

  it("blocks at send time if the template was approved at selection but has since flipped to REJECTED (the actual race M5's window check already established a precedent for)", async () => {
    const { org, channel, user, conversation } = await makeFixture("TplRace");
    await createTemplate(org.id, channel.id, {
      name: "order_update",
      language: "en",
      category: "UTILITY",
      status: "APPROVED",
      components: { body: "Hi {{1}}." },
    });

    // Selection-time check passes — the template is genuinely APPROVED
    // right now, so a PENDING row and a job get created exactly like the
    // success case above.
    const result = await sendTemplateMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      userId: user.id,
      templateName: "order_update",
      languageCode: "en",
      variables: { "1": "Asha" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Meta's own sync (or a paused/rejected status arriving) flips the
    // template in the gap between that request and the Worker actually
    // running — exactly the scenario sendTemplateViaProvider's own doc
    // comment (send-message.consumer.ts) exists to guard against.
    await updateTemplateStatus(org.id, channel.id, "order_update", "en", "REJECTED");

    await processSendMessageJob({ organizationId: org.id, messageId: result.message.id });

    const final = await prisma.message.findUnique({ where: { id: result.message.id } });
    expect(final?.status).toBe("FAILED");
    expect(final?.errorCode).toBe("TEMPLATE_NOT_APPROVED");
    // The Worker's re-check caught it before ever reaching the provider —
    // the mocked sendTemplate() must never have been called.
    expect(state.calls).toHaveLength(0);
  });
});
