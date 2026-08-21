import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { checkWindowOpenForSend } from "./simulate-window";

/**
 * Real-Postgres proof of context.md §8.0.4's Baileys-adapter simulation
 * rule: "Adapter checks lastInboundAt and returns { ok: false, retryable:
 * false, code: 'WINDOW_CLOSED' } on a free-form send outside the window."
 * `checkWindowOpenForSend` is the literal function `sendText`/`sendMedia`
 * call to do this (src/providers/baileys/adapter.ts's `checkWindow`
 * helper) — exercised here directly against real Postgres rather than only
 * through the adapter's full method (see adapter-window.integration.test.ts
 * for that direct-against-sendText() proof, using registerChannelForTest to
 * avoid needing a live WhatsApp socket).
 */
const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeFixture(label: string, lastInboundAt: Date | null) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000001",
    provider: "baileys",
    status: "ACTIVE",
  });
  const contact = await upsertContact(org.id, { waId: `9188${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: lastInboundAt ?? new Date(),
  });
  return { org, channel, contact, conversation };
}

afterAll(async () => {
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("checkWindowOpenForSend (real Postgres)", () => {
  it("returns a WINDOW_CLOSED SendResult when lastInboundAt is over 24h old", async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { org, channel, contact } = await makeFixture("Closed", twentyFiveHoursAgo);

    const result = await checkWindowOpenForSend(org.id, channel.id, contact.waId);
    expect(result).toEqual({
      ok: false,
      retryable: false,
      code: "WINDOW_CLOSED",
      message: expect.any(String),
    });
  });

  it("returns null (no rejection) when lastInboundAt is well within the window", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { org, channel, contact } = await makeFixture("Open", oneHourAgo);

    const result = await checkWindowOpenForSend(org.id, channel.id, contact.waId);
    expect(result).toBeNull();
  });

  it("returns null when there's no known contact for this waId at all", async () => {
    const org = await createOrganization(`No Contact ${suffix}`);
    createdOrgIds.push(org.id);
    const channel = await createChannel(org.id, {
      displayName: "No contact channel",
      phoneNumber: "10000000002",
      provider: "baileys",
      status: "ACTIVE",
    });

    const result = await checkWindowOpenForSend(org.id, channel.id, `9199${suffix}unknown`);
    expect(result).toBeNull();
  });
});
