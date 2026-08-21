import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "@/data/organizations";
import { createChannel } from "@/data/channels";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { BaileysProvider } from "./adapter";

/**
 * Real-Postgres proof that the window-check is wired into the ACTUAL
 * `sendText()`/`sendMedia()` methods (not just checkWindowOpenForSend in
 * isolation — see simulate-window.integration.test.ts for that) — this
 * milestone's own "tested directly against the real adapter function"
 * verification requirement.
 *
 * `registerChannelForTest` (adapter.ts, test-support only — mirrors
 * src/lib/auth/session.ts's `sealSessionCookie` precedent) populates the
 * adapter's in-memory channelId -> Channel map WITHOUT opening a live
 * Baileys socket (`connect()` itself is untouched and still does the real
 * thing) — there is still no dedicated WhatsApp test number available
 * (TODO-VERIFY.md). Because `sendText`/`sendMedia` check the window BEFORE
 * checking for a live socket (adapter.ts's own doc comment explains this
 * ordering), a closed-window conversation returns WINDOW_CLOSED here even
 * with no socket ever connected — proving the guard fires independently of
 * socket/connection state, exactly as context.md §8.0.4 describes.
 *
 * A fresh `BaileysProvider` instance is used per test (not the shared
 * `baileysAdapter` singleton) so registering a channel here can't leak into
 * `adapter.test.ts`'s "no live socket at all" graceful-failure tests, which
 * rely on the shared singleton never having seen any channel.
 */
const suffix = randomUUID().slice(0, 8);
const createdOrgIds: string[] = [];

async function makeFixture(label: string, lastInboundAt: Date) {
  const org = await createOrganization(`${label} ${suffix}`);
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: `${label} channel`,
    phoneNumber: "10000000004",
    provider: "baileys",
    status: "ACTIVE",
  });
  const contact = await upsertContact(org.id, { waId: `9177${suffix}${label.length}` });
  await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: lastInboundAt,
  });
  return { org, channel, contact };
}

afterAll(async () => {
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("BaileysProvider.sendText()/sendMedia() — real window-check, no live socket needed", () => {
  it("sendText returns WINDOW_CLOSED for a conversation whose window closed over 24h ago", async () => {
    const adapter = new BaileysProvider();
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { channel, contact } = await makeFixture("AdapterClosed", twentyFiveHoursAgo);

    adapter.registerChannelForTest(channel);

    await expect(
      adapter.sendText({ channelId: channel.id, to: contact.waId, body: "hello" }),
    ).resolves.toEqual({
      ok: false,
      retryable: false,
      code: "WINDOW_CLOSED",
      message: expect.any(String),
    });
  });

  it("sendMedia returns WINDOW_CLOSED for the same closed-window conversation, before its NOT_IMPLEMENTED stub body", async () => {
    const adapter = new BaileysProvider();
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { channel, contact } = await makeFixture("AdapterClosedMedia", twentyFiveHoursAgo);

    adapter.registerChannelForTest(channel);

    await expect(
      adapter.sendMedia({
        channelId: channel.id,
        to: contact.waId,
        media: { id: "media-1", mimeType: "image/png" },
      }),
    ).resolves.toEqual({
      ok: false,
      retryable: false,
      code: "WINDOW_CLOSED",
      message: expect.any(String),
    });
  });

  it("sendText falls through to NO_ACTIVE_SESSION (not WINDOW_CLOSED) when the window is open but there's no live socket", async () => {
    const adapter = new BaileysProvider();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { channel, contact } = await makeFixture("AdapterOpen", oneHourAgo);

    adapter.registerChannelForTest(channel);

    await expect(
      adapter.sendText({ channelId: channel.id, to: contact.waId, body: "hello" }),
    ).resolves.toEqual({
      ok: false,
      retryable: true,
      code: "NO_ACTIVE_SESSION",
      message: expect.any(String),
    });
  });
});
