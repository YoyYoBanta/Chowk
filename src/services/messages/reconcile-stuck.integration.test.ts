import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { createUser } from "@/data/users";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { reconcileStuckPendingMessagesForOrg } from "./reconcile-stuck";

/**
 * implementation-plan.md's M9 hardening item: "a scheduled job that flags/
 * re-checks Message rows stuck in PENDING past a timeout." Real Postgres
 * throughout — this is pure data-layer logic, no queue/provider involved,
 * so no factory mock is needed either.
 */
const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeFixture(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000007",
    provider: "baileys",
    status: "ACTIVE",
  });
  const user = await createUser(org.id, {
    email: `agent-${label}-${suffix}@test.chowk`.toLowerCase(),
    passwordHash: "not-a-real-hash",
    name: "Test Agent",
  });
  const contact = await upsertContact(org.id, { waId: `9169${suffix}${label.length}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  return { org, channel, user, contact, conversation };
}

async function createOutboundMessage(
  organizationId: string,
  conversationId: string,
  opts: { status: "PENDING" | "SENT"; createdAt: Date },
) {
  return prisma.message.create({
    data: {
      organizationId,
      conversationId,
      provider: "baileys",
      direction: "OUTBOUND",
      type: "TEXT",
      body: "reconciliation fixture",
      status: opts.status,
      metaTimestamp: opts.createdAt,
      createdAt: opts.createdAt,
    },
  });
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

describe("reconcileStuckPendingMessagesForOrg (real Postgres)", () => {
  it("marks a PENDING message older than the threshold as FAILED/STUCK_PENDING_TIMEOUT", async () => {
    const { org, conversation } = await makeFixture("Stuck");
    const oldEnough = new Date(Date.now() - 45 * 60 * 1000); // 45 min ago, past the 30-min threshold
    const stuck = await createOutboundMessage(org.id, conversation.id, { status: "PENDING", createdAt: oldEnough });

    const count = await reconcileStuckPendingMessagesForOrg(org.id);
    expect(count).toBe(1);

    const after = await prisma.message.findUnique({ where: { id: stuck.id } });
    expect(after?.status).toBe("FAILED");
    expect(after?.errorCode).toBe("STUCK_PENDING_TIMEOUT");
  });

  it("leaves a recently-created PENDING message untouched — still legitimately in flight", async () => {
    const { org, conversation } = await makeFixture("Fresh");
    const justNow = new Date();
    const fresh = await createOutboundMessage(org.id, conversation.id, { status: "PENDING", createdAt: justNow });

    const count = await reconcileStuckPendingMessagesForOrg(org.id);
    expect(count).toBe(0);

    const after = await prisma.message.findUnique({ where: { id: fresh.id } });
    expect(after?.status).toBe("PENDING");
  });

  it("never touches a message that's already resolved, no matter how old", async () => {
    const { org, conversation } = await makeFixture("AlreadySent");
    const veryOld = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sent = await createOutboundMessage(org.id, conversation.id, { status: "SENT", createdAt: veryOld });

    const count = await reconcileStuckPendingMessagesForOrg(org.id);
    expect(count).toBe(0);

    const after = await prisma.message.findUnique({ where: { id: sent.id } });
    expect(after?.status).toBe("SENT");
  });

  it("cross-tenant isolation: reconciling Org A never touches Org B's stuck message", async () => {
    const a = await makeFixture("Cross A");
    const b = await makeFixture("Cross B");
    const oldEnough = new Date(Date.now() - 45 * 60 * 1000);
    const stuckInB = await createOutboundMessage(b.org.id, b.conversation.id, { status: "PENDING", createdAt: oldEnough });

    await reconcileStuckPendingMessagesForOrg(a.org.id);

    const after = await prisma.message.findUnique({ where: { id: stuckInB.id } });
    expect(after?.status).toBe("PENDING");
  });
});
