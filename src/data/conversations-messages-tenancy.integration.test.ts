import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "./organizations";
import { createChannel } from "./channels";
import { upsertContact } from "./contacts";
import {
  upsertConversationForInbound,
  getConversationById,
  getConversationWithContact,
  listConversationsPage,
} from "./conversations";
import { createMessage, listMessagesPage } from "./messages";

/**
 * M3's extension of M1's cross-tenant isolation test pattern
 * (src/data/tenancy-isolation.integration.test.ts) to Conversation/Message
 * — real Postgres, no mocking. This is the data-layer half of the
 * milestone's tenancy requirement; src/app/api/conversations/tenancy.integration.test.ts
 * covers the same boundary one layer up, through the actual route
 * handlers.
 */

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeOrgWithChannelAndConversation(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000002",
    provider: "baileys",
    status: "DISCONNECTED",
  });
  const contact = await upsertContact(org.id, { waId: `91${suffix}${label.length}`, name: label });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  const message = await createMessage(org.id, {
    conversationId: conversation.id,
    provider: "baileys",
    providerMessageId: `tenancy-${org.id}-${label}`,
    direction: "INBOUND",
    type: "TEXT",
    body: "hello from a real message",
    metaTimestamp: new Date(),
  });
  return { org, channel, contact, conversation, message };
}

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("cross-tenant isolation: Conversation/Message (real Postgres, no mocking)", () => {
  it("getConversationById/getConversationWithContact never return Org B's conversation for Org A", async () => {
    const a = await makeOrgWithChannelAndConversation("Tenancy Org A");
    const b = await makeOrgWithChannelAndConversation("Tenancy Org B");

    await expect(getConversationById(a.org.id, b.conversation.id)).resolves.toBeNull();
    await expect(getConversationById(b.org.id, a.conversation.id)).resolves.toBeNull();
    await expect(getConversationWithContact(a.org.id, b.conversation.id)).resolves.toBeNull();

    // Scoped correctly, it still works.
    await expect(getConversationById(a.org.id, a.conversation.id)).resolves.toMatchObject({
      id: a.conversation.id,
    });
  });

  it("listConversationsPage for Org A never includes Org B's conversation", async () => {
    const a = await makeOrgWithChannelAndConversation("Tenancy Org C");
    const b = await makeOrgWithChannelAndConversation("Tenancy Org D");

    const { items } = await listConversationsPage(a.org.id, { limit: 50 });
    expect(items.map((c) => c.id)).toContain(a.conversation.id);
    expect(items.map((c) => c.id)).not.toContain(b.conversation.id);
  });

  it("listMessagesPage scoped to Org A never returns Org B's message, even for Org B's own conversation id", async () => {
    const a = await makeOrgWithChannelAndConversation("Tenancy Org E");
    const b = await makeOrgWithChannelAndConversation("Tenancy Org F");

    // Guessing Org B's conversation id while scoped to Org A comes back empty.
    const { items: crossOrgItems } = await listMessagesPage(a.org.id, b.conversation.id, { limit: 10 });
    expect(crossOrgItems).toHaveLength(0);

    const { items: ownItems } = await listMessagesPage(a.org.id, a.conversation.id, { limit: 10 });
    expect(ownItems.map((m) => m.id)).toContain(a.message.id);
  });
});
