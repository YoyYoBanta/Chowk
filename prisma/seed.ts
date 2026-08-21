/**
 * Local dev seed script. Wired via `prisma.config.ts` (`migrations.seed`,
 * the Prisma 7 convention — package.json's `prisma.seed` field is the
 * pre-7 convention and is no longer read). Run with:
 *
 *   npx prisma db seed
 *
 * Extend this file milestone by milestone: keep each milestone's seed data
 * in its own clearly-labeled, appendable section (see `main()` below)
 * rather than rewriting what's already here. M2+ adds Channel/Contact/
 * Conversation/Message seed data in the same style.
 *
 * Passwords below are fixed, documented, local-dev-only values — never
 * real secrets, never used outside a local/dev database.
 */
import { prisma } from "../src/lib/prisma";
import { createOrganization, listOrganizations } from "../src/data/organizations";
import { createUser } from "../src/data/users";
import { createChannel, listChannelsInOrg } from "../src/data/channels";
import { upsertContact } from "../src/data/contacts";
import { upsertConversationForInbound, listConversationsInOrg } from "../src/data/conversations";
import { createMessage } from "../src/data/messages";
import { hashPassword } from "../src/lib/auth/password";

const DEV_PASSWORD = "chowk-dev-password";

async function seedM1TenancyAndUsers(): Promise<void> {
  const acme = await createOrganization("Acme Textiles");
  const globex = await createOrganization("Globex Traders");

  const passwordHash = await hashPassword(DEV_PASSWORD);

  await createUser(acme.id, {
    email: "admin@acme.chowk.test",
    name: "Amara Acme",
    passwordHash,
    role: "ADMIN",
  });
  await createUser(acme.id, {
    email: "agent@acme.chowk.test",
    name: "Amit Acme",
    passwordHash,
    role: "AGENT",
  });

  await createUser(globex.id, {
    email: "admin@globex.chowk.test",
    name: "Gabi Globex",
    passwordHash,
    role: "ADMIN",
  });
  await createUser(globex.id, {
    email: "agent@globex.chowk.test",
    name: "Gus Globex",
    passwordHash,
    role: "AGENT",
  });

  console.log("Seeded M1: 2 organizations (Acme Textiles, Globex Traders), 4 users.");
  console.log(`All seeded users share the dev password: "${DEV_PASSWORD}"`);
}

/**
 * One Baileys channel per organization that doesn't already have one.
 * Status is DISCONNECTED on purpose — there is no dedicated WhatsApp test
 * number available yet (see TODO-VERIFY.md's M2 section), so seeding an
 * ACTIVE channel here would misrepresent a session that doesn't exist.
 * `phoneNumber` is a placeholder value (display-only field per
 * context.md §7.2) until a real number is assigned to a channel.
 *
 * Written to be safe to re-run: it checks each organization for an
 * existing channel first rather than unconditionally inserting (M1's own
 * org/user seeding above is not itself idempotent — re-running `npm run
 * seed` creates fresh duplicate organizations each time, same as before
 * this milestone — so this only guards its own concern: never adding a
 * second channel to an org row that already has one).
 */
async function seedM2Channels(): Promise<void> {
  const orgs = await listOrganizations();
  let created = 0;

  for (const org of orgs) {
    const existingChannels = await listChannelsInOrg(org.id);
    if (existingChannels.length > 0) continue;

    await createChannel(org.id, {
      displayName: `${org.name} WhatsApp (Baileys, dev)`,
      phoneNumber: "000000000000",
      provider: "baileys",
      status: "DISCONNECTED",
    });
    created += 1;
  }

  console.log(
    `Seeded M2: ${created} Baileys channel(s), status DISCONNECTED (no live session — see TODO-VERIFY.md).`,
  );
}

/**
 * A handful of contacts/conversations/messages per organization, built
 * through the exact same data-layer calls the real ingest-inbound
 * consumer uses (upsertContact → upsertConversationForInbound →
 * createMessage) rather than raw `prisma.*.create` — so seeded data has
 * the same shape (unreadCount incremented per message, lastMessageAt/
 * lastInboundAt set, etc.) real ingestion would produce. This is what lets
 * `npm run dev` show a populated inbox (M3's list/thread UI) without a
 * live WhatsApp number.
 *
 * Deliberately exercises a few different `MessageType`s (including
 * `UNSUPPORTED`) per conversation so the thread view's per-type
 * placeholders (context.md §10.3) are visible without hand-testing.
 *
 * Idempotent for its own concern only, same spirit as seedM2Channels:
 * skipped entirely for an org that already has at least one conversation.
 */
async function seedM3Inbox(): Promise<void> {
  const orgs = await listOrganizations();
  let seededOrgs = 0;

  for (const org of orgs) {
    const existingConversations = await listConversationsInOrg(org.id);
    if (existingConversations.length > 0) continue;

    const [channel] = await listChannelsInOrg(org.id);
    if (!channel) continue;

    const contacts = [
      { waId: `91900${org.id.slice(-6)}01`, name: "Priya Sharma" },
      { waId: `91900${org.id.slice(-6)}02`, name: "Rahul Verma" },
      { waId: `91900${org.id.slice(-6)}03`, name: null },
    ];

    const now = Date.now();
    let conversationIndex = 0;

    for (const contactInput of contacts) {
      conversationIndex += 1;
      const contact = await upsertContact(org.id, contactInput);

      // Spread conversations' last-activity times apart so the list's
      // most-recent-first ordering is visibly meaningful.
      const baseTime = now - conversationIndex * 3_600_000;

      const events: Array<{
        offsetMs: number;
        direction: "INBOUND" | "OUTBOUND";
        type: "TEXT" | "IMAGE" | "LOCATION" | "UNSUPPORTED";
        body?: string | null;
      }> = [
        { offsetMs: -600_000, direction: "INBOUND", type: "TEXT", body: "Hi, is my order shipped yet?" },
        { offsetMs: -540_000, direction: "OUTBOUND", type: "TEXT", body: "Let me check that for you." },
        { offsetMs: -60_000, direction: "INBOUND", type: "IMAGE", body: "Photo of the damaged package" },
      ];
      if (conversationIndex === 1) {
        events.push({ offsetMs: -30_000, direction: "INBOUND", type: "LOCATION", body: null });
        events.push({ offsetMs: -10_000, direction: "INBOUND", type: "UNSUPPORTED", body: null });
      }

      let conversationId: string | undefined;
      for (const event of events) {
        const occurredAt = new Date(baseTime + event.offsetMs);
        const conversation = await upsertConversationForInbound(org.id, {
          channelId: channel.id,
          contactId: contact.id,
          occurredAt,
        });
        conversationId = conversation.id;
        await createMessage(org.id, {
          conversationId: conversation.id,
          provider: channel.provider,
          providerMessageId: `seed-${org.id}-${contact.id}-${event.offsetMs}`,
          direction: event.direction,
          type: event.type,
          body: event.body ?? null,
          rawPayload: { seed: true, type: event.type },
          metaTimestamp: occurredAt,
        });
      }
      void conversationId;
    }

    seededOrgs += 1;
  }

  console.log(`Seeded M3: inbox demo data (contacts/conversations/messages) for ${seededOrgs} organization(s).`);
}

async function main(): Promise<void> {
  // --- M1: tenancy + auth skeleton ---
  await seedM1TenancyAndUsers();

  // --- M2: provider adapter + ingestion ---
  await seedM2Channels();

  // --- M3: read-only inbox demo data ---
  await seedM3Inbox();

  // --- M4+: append new sections below this line, do not reorder above ---
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
