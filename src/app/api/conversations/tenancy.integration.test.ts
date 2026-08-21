import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { createMessage } from "@/data/messages";
import { SESSION_COOKIE_NAME, sealSessionCookie } from "@/lib/auth/session";
import { GET as listConversationsGET } from "./route";
import { GET as conversationDetailGET } from "./[id]/route";
import { GET as conversationMessagesGET } from "./[id]/messages/route";

/**
 * API-layer counterpart to
 * src/data/conversations-messages-tenancy.integration.test.ts — same
 * tenancy boundary, proven one layer up through the actual exported route
 * handler functions rather than the data layer directly.
 *
 * Route handlers are called directly (imported and invoked with a
 * hand-built `NextRequest`) rather than through a running `next
 * dev`/`next start` server. This works because `getSessionFromRequest`
 * (src/lib/auth/session.ts) reads the session straight off the `Request`'s
 * `Cookie` header via iron-session's `getIronSession(request, response,
 * options)` overload — no Next-internal AsyncLocalStorage request context
 * required, so the exported `GET` functions behave identically here as
 * they would under a real server. `sealSessionCookie` (also new this
 * milestone, test-support only) mints a validly-sealed session cookie
 * without driving the actual login form.
 */

const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeOrgWithConversation(label: string) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000003",
    provider: "baileys",
    status: "DISCONNECTED",
  });
  const contact = await upsertContact(org.id, { waId: `92${suffix}${label.length}`, name: label });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  await createMessage(org.id, {
    conversationId: conversation.id,
    provider: "baileys",
    providerMessageId: `api-tenancy-${org.id}-${label}`,
    direction: "INBOUND",
    type: "TEXT",
    body: "hello via the real route handler",
    metaTimestamp: new Date(),
  });
  return { org, conversation };
}

async function cookieHeaderFor(organizationId: string): Promise<string> {
  const sealed = await sealSessionCookie({
    userId: `user_${randomUUID().slice(0, 8)}`,
    organizationId,
    role: "AGENT",
  });
  return `${SESSION_COOKIE_NAME}=${sealed}`;
}

function requestWithCookie(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, {
    headers: cookie ? { cookie } : undefined,
  });
}

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("GET /api/conversations* — tenancy boundary (real Postgres, real route handlers)", () => {
  it("401s with no session cookie at all", async () => {
    const res = await listConversationsGET(requestWithCookie("http://localhost/api/conversations"));
    expect(res.status).toBe(401);
  });

  it("GET /api/conversations/:id 404s for another organization's conversation, 200s for its own", async () => {
    const a = await makeOrgWithConversation("Route Tenancy Org A");
    const b = await makeOrgWithConversation("Route Tenancy Org B");
    const cookieA = await cookieHeaderFor(a.org.id);

    const crossOrgRes = await conversationDetailGET(
      requestWithCookie(`http://localhost/api/conversations/${b.conversation.id}`, cookieA),
      { params: Promise.resolve({ id: b.conversation.id }) },
    );
    expect(crossOrgRes.status).toBe(404);

    const ownRes = await conversationDetailGET(
      requestWithCookie(`http://localhost/api/conversations/${a.conversation.id}`, cookieA),
      { params: Promise.resolve({ id: a.conversation.id }) },
    );
    expect(ownRes.status).toBe(200);
    const ownBody = (await ownRes.json()) as { conversation: { id: string } };
    expect(ownBody.conversation.id).toBe(a.conversation.id);
  });

  it("GET /api/conversations/:id/messages 404s for another organization's conversation and never leaks its messages", async () => {
    const a = await makeOrgWithConversation("Route Tenancy Org C");
    const b = await makeOrgWithConversation("Route Tenancy Org D");
    const cookieA = await cookieHeaderFor(a.org.id);

    const res = await conversationMessagesGET(
      requestWithCookie(`http://localhost/api/conversations/${b.conversation.id}/messages`, cookieA),
      { params: Promise.resolve({ id: b.conversation.id }) },
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/conversations only ever returns the caller's own organization's conversations", async () => {
    const a = await makeOrgWithConversation("Route Tenancy Org E");
    const b = await makeOrgWithConversation("Route Tenancy Org F");
    const cookieA = await cookieHeaderFor(a.org.id);

    const res = await listConversationsGET(
      requestWithCookie("http://localhost/api/conversations?limit=100", cookieA),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversations: Array<{ id: string }> };
    const ids = body.conversations.map((c) => c.id);
    expect(ids).toContain(a.conversation.id);
    expect(ids).not.toContain(b.conversation.id);
  });
});
