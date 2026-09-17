/**
 * Phase A live verification — Smoke Test Script (`npm run smoke`)
 *
 * Usage:
 *   npm run smoke -- --to <number> --text <message>
 *
 * Options:
 *   --to <number>       Recipient phone number (digits only or +E.164) [Required]
 *   --text <message>    Message content to send [Required]
 *   --timeout <ms>      Timeout in milliseconds to wait for ACK confirmation (default: 30000)
 *   --listen            Keep running after send to listen for and log inbound replies
 *
 * Requirements:
 * 1. Loads the existing session through WhatsAppProvider interface (NOT importing Baileys directly).
 * 2. Prints: provider used, message id, and final ack status.
 * 3. Inbound listener logs every received message to console and to the DB.
 * 4. Distinct exit codes for failure modes:
 *    - Exit 0:  Success (confirmed send + ACK received)
 *    - Exit 10: Session missing/expired
 *    - Exit 11: Recipient not on WhatsApp
 *    - Exit 12: Network failure
 *    - Exit 13: Send timeout (unconfirmed send)
 *    - Exit 14: Unsafe transport environment (TRANSPORT_ENV != "sandbox")
 *    - Exit 15: Invalid CLI arguments
 *    - Exit 1:  General error
 * 5. Hard guard: Refuses to send if TRANSPORT_ENV != "sandbox".
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getWhatsAppProvider } from "../src/providers/factory";
import type { Channel } from "@prisma/client";
import type { NormalizedInboundEvent, NormalizedStatusEvent } from "../src/providers/types";
import { upsertContact } from "../src/data/contacts";
import { upsertConversationForInbound } from "../src/data/conversations";
import { createMessage } from "../src/data/messages";

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  SESSION_MISSING_OR_EXPIRED: 10,
  RECIPIENT_NOT_ON_WHATSAPP: 11,
  NETWORK_FAILURE: 12,
  SEND_TIMEOUT: 13,
  UNSAFE_TRANSPORT_ENV: 14,
  INVALID_ARGUMENTS: 15,
} as const;

interface SmokeArgs {
  to?: string;
  text?: string;
  channelId?: string;
  timeoutMs: number;
  listen: boolean;
}

export function parseCliArgs(argv: string[]): SmokeArgs {
  const args: SmokeArgs = {
    timeoutMs: 30000,
    listen: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--to" && i + 1 < argv.length) {
      args.to = argv[++i];
    } else if (arg.startsWith("--to=")) {
      args.to = arg.slice(5);
    } else if (arg === "--text" && i + 1 < argv.length) {
      args.text = argv[++i];
    } else if (arg.startsWith("--text=")) {
      args.text = arg.slice(7);
    } else if (arg === "--channel" && i + 1 < argv.length) {
      args.channelId = argv[++i];
    } else if (arg.startsWith("--channel=")) {
      args.channelId = arg.slice(10);
    } else if (arg === "--timeout" && i + 1 < argv.length) {
      args.timeoutMs = parseInt(argv[++i], 10) || 30000;
    } else if (arg.startsWith("--timeout=")) {
      args.timeoutMs = parseInt(arg.slice(10), 10) || 30000;
    } else if (arg === "--listen") {
      args.listen = true;
    }
  }

  return args;
}

export function sanitizePhoneNumber(to: string): string {
  return to.replace(/[^0-9]/g, "");
}

export function checkSandboxGuard(): boolean {
  const transportEnv = process.env.TRANSPORT_ENV ?? "sandbox";
  if (transportEnv !== "sandbox") {
    console.error(`
********************************************************************************
[SECURITY HARD GUARD TRIGGERED]
Refusing to send via Baileys because TRANSPORT_ENV is '${transportEnv}' (must be 'sandbox').
Baileys uses an unofficial WhatsApp Web protocol.
Baileys must NEVER be used with a partner-facing or production number!
********************************************************************************
`);
    return false;
  }
  return true;
}

export async function checkSessionInDb(channelId: string): Promise<boolean> {
  try {
    const row = await prisma.baileysSessionData.findUnique({ where: { channelId } });
    if (!row || !row.creds) return false;
    const creds = row.creds as { me?: unknown; registered?: unknown };
    return !!(creds && (creds.me || creds.registered));
  } catch {
    return false;
  }
}

async function resolveChannel(channelId?: string): Promise<Channel> {
  if (channelId) {
    const found = await prisma.channel.findUnique({ where: { id: channelId } });
    if (found) return found;
    console.warn(`[smoke] Channel with ID "${channelId}" not found in DB. Falling back to first Baileys channel.`);
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
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (!cliArgs.to || !cliArgs.text) {
    console.error(`
Error: Missing required arguments.

Usage:
  npm run smoke -- --to <number> --text <message> [options]

Options:
  --to <number>      Recipient phone number (e.g. 15551234567) [Required]
  --text <msg>       Message text [Required]
  --channel <id>     Specific Channel ID to use (optional, defaults to first Baileys channel)
  --timeout <ms>     Confirmation timeout in milliseconds (default: 30000)
  --listen           Keep running after sending to listen for inbound replies
`);
    process.exit(EXIT_CODES.INVALID_ARGUMENTS);
  }

  const rawTo = cliArgs.to;
  const text = cliArgs.text;
  const sanitizedTo = sanitizePhoneNumber(rawTo);

  if (sanitizedTo.length < 7 || sanitizedTo.length > 15) {
    console.error(`[smoke] Invalid phone number: "${rawTo}". Phone numbers must contain 7 to 15 digits.`);
    process.exit(EXIT_CODES.INVALID_ARGUMENTS);
  }

  // 1. Hard sandbox guard
  if (!checkSandboxGuard()) {
    process.exit(EXIT_CODES.UNSAFE_TRANSPORT_ENV);
  }

  // 2. Resolve Channel from Postgres
  let channel: Channel;
  try {
    channel = await resolveChannel(cliArgs.channelId);
  } catch (err) {
    console.error(`[smoke] Database channel resolution error:`, err instanceof Error ? err.message : err);
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }

  // 3. Check session existence in PostgreSQL
  const hasSession = await checkSessionInDb(channel.id);
  if (!hasSession) {
    console.error(`
[smoke] SESSION ERROR (Exit Code ${EXIT_CODES.SESSION_MISSING_OR_EXPIRED}):
No valid/paired Baileys session found in PostgreSQL for channel "${channel.displayName}" (${channel.id}).
Please pair your throwaway number first by running:
  npm run pair
`);
    process.exit(EXIT_CODES.SESSION_MISSING_OR_EXPIRED);
  }

  console.log(`[smoke] Found valid session in PostgreSQL for channel "${channel.displayName}" (${channel.id}).`);
  console.log(`[smoke] Initializing provider interface...`);

  // 4. Obtain provider through the official interface abstraction
  const provider = getWhatsAppProvider();
  console.log(`[smoke] Provider obtained: "${provider.name}"`);

  // 4. Register inbound message listener
  provider.onInbound(async (event) => {
    await handleInboundMessage(channel, event);
  });

  // 5. Connect and await active socket
  console.log(`[smoke] Connecting to WhatsApp via ${provider.name}...`);
  try {
    await provider.connect(channel);
  } catch (err) {
    console.error(`[smoke] Failed to connect:`, err);
    process.exit(EXIT_CODES.NETWORK_FAILURE);
  }

  // Wait briefly for connection state to settle
  let state = await provider.getConnectionState(channel.id);
  let attempts = 0;
  while (state.status === "connecting" && attempts < 20) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await provider.getConnectionState(channel.id);
    attempts++;
  }

  if (state.status === "qr_pending" || state.status === "disconnected") {
    console.error(`[smoke] Session is expired or not paired (state: ${state.status}). Please run "npm run pair".`);
    process.exit(EXIT_CODES.SESSION_MISSING_OR_EXPIRED);
  }

  console.log(`[smoke] Connected. Preparing to send message to +${sanitizedTo}...`);

  // 6. Set up ACK listener promise
  let resolveAck: (status: NormalizedStatusEvent) => void;
  const ackPromise = new Promise<NormalizedStatusEvent>((resolve) => {
    resolveAck = resolve;
  });

  let sentMessageId: string | null = null;

  provider.onStatusUpdate(async (statusEvent) => {
    if (sentMessageId && statusEvent.providerMessageId === sentMessageId) {
      resolveAck(statusEvent);
    }
  });

  // 7. Send text message through WhatsAppProvider interface
  const sendResult = await provider.sendText({
    channelId: channel.id,
    to: sanitizedTo,
    body: text,
  });

  if (!sendResult.ok) {
    console.error(`[smoke] Send rejected with code "${sendResult.code}": ${sendResult.message}`);
    if (sendResult.code === "NO_ACTIVE_SESSION" || sendResult.code === "SESSION_EXPIRED") {
      process.exit(EXIT_CODES.SESSION_MISSING_OR_EXPIRED);
    } else if (sendResult.code === "RECIPIENT_NOT_ON_WHATSAPP") {
      process.exit(EXIT_CODES.RECIPIENT_NOT_ON_WHATSAPP);
    } else if (sendResult.code === "NETWORK_FAILURE") {
      process.exit(EXIT_CODES.NETWORK_FAILURE);
    } else if (sendResult.code === "UNSAFE_TRANSPORT_ENV") {
      process.exit(EXIT_CODES.UNSAFE_TRANSPORT_ENV);
    }
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }

  sentMessageId = sendResult.providerMessageId;
  console.log(`[smoke] Message dispatched! Provider Message ID: ${sentMessageId}`);
  console.log(`[smoke] Waiting for server ACK status (timeout: ${cliArgs.timeoutMs}ms)...`);

  // 8. Await ACK or timeout
  let ackStatus: string = "SENT";
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("TIMEOUT")), cliArgs.timeoutMs);
    });

    const statusEvent = await Promise.race([ackPromise, timeoutPromise]);
    ackStatus = statusEvent.status;

    if (statusEvent.status === "FAILED") {
      console.error(`[smoke] Delivery failed: code=${statusEvent.errorCode ?? "UNKNOWN"} msg=${statusEvent.errorMessage ?? "No error message"}`);
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  } catch (err) {
    if (err instanceof Error && err.message === "TIMEOUT") {
      console.error(`
[smoke] TIMEOUT ERROR (Exit Code ${EXIT_CODES.SEND_TIMEOUT}):
Message was dispatched with ID "${sentMessageId}", but WhatsApp servers did not confirm receipt within ${cliArgs.timeoutMs}ms.
Never resolving as success on an unconfirmed send.
`);
      process.exit(EXIT_CODES.SEND_TIMEOUT);
    }
    console.error(`[smoke] Error waiting for ACK:`, err);
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }

  // 9. Output required smoke test results
  console.log(`
================================================================================
SMOKE TEST RESULT: SUCCESS (CONFIRMED)
================================================================================
Provider used:    ${provider.name}
Message ID:       ${sentMessageId}
Final ack status: ${ackStatus}
Recipient:        +${sanitizedTo}
Message text:     "${text}"
Timestamp:        ${new Date().toISOString()}
================================================================================
`);

  if (cliArgs.listen) {
    console.log("[smoke] --listen flag active. Listening for incoming replies (Press Ctrl+C to exit)...");
    const keepAlive = () => setTimeout(keepAlive, 10000);
    keepAlive();
  } else {
    try {
      await provider.disconnect(channel.id);
      await prisma.$disconnect();
    } catch {
      // Best-effort
    }
    process.exit(EXIT_CODES.SUCCESS);
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((err: unknown) => {
    console.error("[smoke] Fatal error:", err);
    process.exit(EXIT_CODES.GENERAL_ERROR);
  });
}
