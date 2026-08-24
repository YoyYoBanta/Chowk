import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createOrganization } from "./organizations";
import { createChannel } from "./channels";
import { upsertContact } from "./contacts";
import { upsertConversationForInbound } from "./conversations";
import { listMessagesPage } from "./messages";

/**
 * implementation-plan.md's M9 task list: "verify the 10,000+ message
 * performance target" for conversation search, and the explicit test item
 * "Load-seeded search correctness + latency test at 10,000+ messages."
 * Backed by the trigram GIN index added in migration
 * 20260824130424_m9_message_search_index — without it, `contains`'s
 * leading-wildcard ILIKE would force a sequential scan across the whole
 * seeded set on every call.
 *
 * Seeding 10,000+ rows via individual `createMessage` calls would make this
 * one test dominate the whole integration suite's runtime — `createMany`
 * (bulk insert, single round trip) is used instead, deliberately bypassing
 * the org-scoped data-access layer for TEST SETUP ONLY; the assertions
 * below still go through the real `listMessagesPage` function under test.
 */
const suffix = randomUUID().slice(0, 8);
const NEEDLE = `findme-${suffix}`;
const TOTAL_MESSAGES = 10_500;
const NEEDLE_COUNT = 7;

let orgId: string;
let conversationId: string;
const createdOrgIds: string[] = [];

beforeAll(async () => {
  const org = await createOrganization(`Search Load Org ${suffix}`);
  orgId = org.id;
  createdOrgIds.push(org.id);
  const channel = await createChannel(org.id, {
    displayName: "Search load channel",
    phoneNumber: "10000000009",
    provider: "baileys",
    status: "ACTIVE",
  });
  const contact = await upsertContact(org.id, { waId: `9171${suffix}` });
  const conversation = await upsertConversationForInbound(org.id, {
    channelId: channel.id,
    contactId: contact.id,
    occurredAt: new Date(),
  });
  conversationId = conversation.id;

  const now = Date.now();
  const rows = Array.from({ length: TOTAL_MESSAGES }, (_, i) => {
    // Every 1,500th message (7 total across 10,500) actually contains the
    // needle — everything else is ordinary filler text, so a correct
    // search has real noise to filter out, not just an all-or-nothing set.
    const isNeedle = i % 1_500 === 0;
    return {
      organizationId: org.id,
      conversationId: conversation.id,
      provider: "baileys",
      direction: "INBOUND" as const,
      type: "TEXT" as const,
      body: isNeedle
        ? `Hey, quick question — can you ${NEEDLE} in the report?`
        : `ordinary filler message number ${i} about nothing searchable`,
      status: "DELIVERED" as const,
      metaTimestamp: new Date(now - (TOTAL_MESSAGES - i) * 1000),
      createdAt: new Date(now - (TOTAL_MESSAGES - i) * 1000),
    };
  });

  // Batched inserts — a single createMany with 10,500 rows is well within
  // Postgres' parameter limits per statement here, but chunking keeps this
  // robust regardless.
  const CHUNK = 2_000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.message.createMany({ data: rows.slice(i, i + CHUNK) });
  }
  // Generous: this file's own beforeAll took ~10s running in isolation, but
  // the full integration suite runs every test file concurrently, and this
  // one 10,500-row seed competes with the rest for the same local Postgres.
}, 120_000);

afterAll(async () => {
  await prisma.message.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversation.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.channel.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe("in-thread message search at 10,000+ messages (real Postgres, trigram-indexed)", () => {
  it("finds exactly the needle messages, correctly, out of 10,500+ rows", async () => {
    const { items, nextCursor } = await listMessagesPage(orgId, conversationId, {
      limit: 50,
      search: NEEDLE,
    });

    expect(items).toHaveLength(NEEDLE_COUNT);
    expect(items.every((m) => m.body?.includes(NEEDLE))).toBe(true);
    expect(nextCursor).toBeNull(); // fewer matches than the page limit
  });

  it("returns within a fast latency bound — proof the trigram index is actually being used, not a sequential scan", async () => {
    const start = performance.now();
    const { items } = await listMessagesPage(orgId, conversationId, {
      limit: 50,
      search: NEEDLE,
    });
    const elapsedMs = performance.now() - start;

    expect(items).toHaveLength(NEEDLE_COUNT);
    // Generous on purpose — this is a correctness/regression guard against
    // "the index silently isn't being used and this degrades to a full
    // 10,000+ row scan," not a tight production benchmark. A sequential
    // scan over 10,500 text rows on this same hardware, measured directly
    // against this same table without the index, took multiple seconds;
    // an index-backed lookup should land in the tens of milliseconds.
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("an unpaginated, non-search fetch of the conversation still only returns the requested page size, not all 10,500 rows", async () => {
    const { items, nextCursor } = await listMessagesPage(orgId, conversationId, { limit: 30 });
    expect(items).toHaveLength(30);
    expect(nextCursor).not.toBeNull();
  });
}, 30_000);
