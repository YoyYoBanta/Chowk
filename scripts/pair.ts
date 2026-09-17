/**
 * Phase A live verification — Pair Script (`npm run pair`)
 *
 * Starts only the Baileys provider, prints the scannable QR code to the terminal,
 * and persists auth state directly to PostgreSQL (`BaileysSessionData` and `BaileysSignalKey`).
 *
 * HARD GUARD: Refuses to run if TRANSPORT_ENV != "sandbox".
 * Baileys is for throwaway numbers only and must NEVER be used with a partner-facing number.
 *
 * Also registers an inbound listener that logs every incoming message to console and DB.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getWhatsAppProvider } from "../src/providers/factory";
import type { Channel } from "@prisma/client";
import type { NormalizedInboundEvent } from "../src/providers/types";
import { upsertContact } from "../src/data/contacts";
import { upsertConversationForInbound } from "../src/data/conversations";
import { createMessage } from "../src/data/messages";

const LOUD_WARNING = `
********************************************************************************
[SECURITY & COMPLIANCE WARNING]
You are starting the Baileys transport provider (Phase A).
Baileys uses an unofficial WhatsApp Web protocol. Meta actively detects and
permanently bans phone numbers using unofficial clients.

RULES FOR PHASE A TESTING:
1. Use a DEDICATED THROWAWAY NUMBER only.
2. NEVER pair a personal or partner-facing phone number.
3. Assume the test number is expendable.
********************************************************************************
`;

function assertSandboxGuard(): void {
  const transportEnv = process.env.TRANSPORT_ENV ?? "sandbox";
  if (transportEnv !== "sandbox") {
    console.error(`
********************************************************************************
[HARD GUARD REFUSAL]
Refusing to pair with Baileys because TRANSPORT_ENV is '${transportEnv}' (must be 'sandbox').
Baileys must NEVER be used with a partner-facing number!
********************************************************************************
`);
    process.exit(14);
  }
}

async function resolveChannel(): Promise<Channel> {
  // Check if a specific channel ID was requested: npm run pair -- <channelId>
  const [explicitChannelId] = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (explicitChannelId) {
    const found = await prisma.channel.findUnique({ where: { id: explicitChannelId } });
    if (found) return found;
    console.warn(`[pair] Channel with ID "${explicitChannelId}" not found in DB. Falling back to first Baileys channel.`);
  }

  const dbChannel = await prisma.channel.findFirst({
    where: { provider: "baileys" },
    orderBy: { createdAt: "asc" },
  });
  if (dbChannel) {
    return dbChannel;
  }

  throw new Error("No Baileys channel found in PostgreSQL database. Please run `npm run seed` first.");
}

async function handleInboundMessage(channel: Channel, event: NormalizedInboundEvent): Promise<void> {
  console.log(`
================================================================================
[INBOUND MESSAGE RECEIVED]
From:        +${event.from} (${event.contactName ?? "Unknown"})
Type:        ${event.type}
Body:        ${event.body ?? "(media/non-text)"}
Message ID:  ${event.providerMessageId}
Timestamp:   ${event.timestamp.toISOString()}
================================================================================
`);

  try {
    const contact = await upsertContact(channel.organizationId, {
      waId: event.from,
      name: event.contactName,
    });
    const conversation = await upsertConversationForInbound(channel.organizationId, {
      channelId: channel.id,
      contactId: contact.id,
      occurredAt: event.timestamp,
    });
    const message = await createMessage(channel.organizationId, {
      conversationId: conversation.id,
      provider: "baileys",
      providerMessageId: event.providerMessageId,
      direction: "INBOUND",
      type: event.type,
      body: event.body,
      rawPayload: event.raw as object,
      metaTimestamp: event.timestamp,
    });
    console.log(`[DB PERSIST] Inbound message saved to DB: Message ${message.id} (Conversation: ${conversation.id})`);
  } catch (err) {
    console.warn("[DB PERSIST] Could not persist inbound message to DB:", err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  console.log(LOUD_WARNING);
  assertSandboxGuard();

  console.log(`[pair] Initializing Baileys provider with PostgreSQL session store...`);

  const provider = getWhatsAppProvider();
  if (provider.name !== "baileys") {
    console.error(`[pair] Expected provider "baileys", but factory returned "${provider.name}". Check WHATSAPP_PROVIDER in .env.`);
    process.exit(1);
  }

  const channel = await resolveChannel();

  // Register inbound listener
  provider.onInbound(async (event) => {
    await handleInboundMessage(channel, event);
  });

  console.log(`[pair] Connecting channel ${channel.displayName} (${channel.id})...`);
  console.log("[pair] If a QR code appears below, scan it with WhatsApp -> Settings -> Linked Devices -> Link a device.\n");

  await provider.connect(channel);

  const cleanup = async (signal: string): Promise<void> => {
    console.log(`\n[pair] Received ${signal}. Disconnecting Baileys socket...`);
    try {
      await provider.disconnect(channel.id);
    } catch {
      // Best-effort
    }
    try {
      await prisma.$disconnect();
    } catch {
      // Best-effort
    }
    console.log("[pair] Disconnected cleanly.");
    process.exit(0);
  };

  process.on("SIGINT", () => void cleanup("SIGINT"));
  process.on("SIGTERM", () => void cleanup("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[pair] Fatal error during pairing:", error);
  process.exit(1);
});
