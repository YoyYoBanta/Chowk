import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySignature } from "@/providers/cloud-api/webhook-verify";
import { env } from "@/config/env";
import { getIngestInboundQueue, getStatusUpdateQueue } from "@/queue/queues";
import { logger, newCorrelationId } from "@/lib/logging/logger";
import type {
  InteractivePayload,
  MediaReference,
  MessageType,
  NormalizedInboundEvent,
  NormalizedStatusEvent,
} from "@/providers/types";

// GET for challenge verification
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// POST for events
export async function POST(req: Request) {
  const correlationId = newCorrelationId();
  const route = "POST /api/webhooks/meta";

  // 1. Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  // 2. Verify signature
  if (env.META_APP_SECRET && !verifySignature(rawBody, signature, env.META_APP_SECRET)) {
    logger.warn("webhook signature verification failed", { correlationId, route, statusCode: 401 });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 3. Insert WebhookEvent
  const eventRecord = await prisma.webhookEvent.create({
    data: {
      rawPayload: JSON.parse(rawBody),
      signature: signature || "missing",
    },
  });

  try {
    const payload = JSON.parse(rawBody);
    
    // Quick enqueue logic (no complex processing inline)
    if (payload.object === "whatsapp_business_account") {
      for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
          if (change.value && change.value.metadata && change.value.metadata.phone_number_id) {
            const phoneNumberId = change.value.metadata.phone_number_id;

            // Fast lookup to resolve organizationId and channelId
            const channel = await prisma.channel.findUnique({
              where: { metaPhoneNumberId: phoneNumberId },
              select: { id: true, organizationId: true },
            });

            if (!channel) {
              logger.warn(`webhook received for unknown metaPhoneNumberId (${phoneNumberId}) — dropping`, {
                correlationId,
                route,
              });
              continue;
            }

            // Ingest Messages
            if (change.value.messages) {
              for (const msg of change.value.messages) {
                const contact = change.value.contacts?.[0];
                const normalized: NormalizedInboundEvent = {
                  channelId: channel.id,
                  providerMessageId: msg.id,
                  from: msg.from,
                  contactName: contact?.profile?.name || null,
                  timestamp: new Date(parseInt(msg.timestamp, 10) * 1000),
                  type: mapMetaMessageType(msg.type),
                  body: msg.text?.body || msg.button?.text || null,
                  media: extractMediaRef(msg),
                  interactive: extractInteractive(msg),
                  raw: msg,
                };

                await getIngestInboundQueue().add(`ingest-${msg.id}`, {
                  organizationId: channel.organizationId,
                  provider: "cloud-api",
                  event: normalized,
                });
              }
            }

            // Ingest Statuses
            if (change.value.statuses) {
              for (const status of change.value.statuses) {
                const normalized: NormalizedStatusEvent = {
                  channelId: channel.id,
                  providerMessageId: status.id,
                  status: mapMetaMessageStatus(status.status),
                  timestamp: new Date(parseInt(status.timestamp, 10) * 1000),
                  errorCode: status.errors?.[0]?.code?.toString(),
                  errorMessage: status.errors?.[0]?.title,
                };

                await getStatusUpdateQueue().add(`status-${status.id}-${status.status}`, {
                  organizationId: channel.organizationId,
                  provider: "cloud-api",
                  event: normalized,
                });
              }
            }
          }
        }
      }
    }

    // Mark processed
    await prisma.webhookEvent.update({
      where: { id: eventRecord.id },
      data: { processedAt: new Date() },
    });
    logger.info("webhook processed", { correlationId, route, statusCode: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("webhook processing error", { correlationId, route, errorMessage });
    await prisma.webhookEvent.update({
      where: { id: eventRecord.id },
      data: { error: errorMessage },
    });
  }

  // 5. Return 200 immediately (or as fast as possible, within 200ms)
  return new NextResponse("OK", { status: 200 });
}

// Helpers for normalization. Field/value names here (hub.mode, hub.verify_token,
// x-hub-signature-256, whatsapp_business_account, metadata.phone_number_id,
// messages/statuses shapes) are NOT yet independently confirmed against
// live Meta Cloud API docs (context.md rule 1) — flagged in TODO-VERIFY.md.
// This whole route is pre-M10 (WHATSAPP_PROVIDER stays "baileys"); the
// verification pass belongs to M10 itself, not this fix-up.
interface MetaInboundMessage {
  id: string;
  from: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
  button?: { text?: string };
  image?: { id: string; mime_type?: string };
  video?: { id: string; mime_type?: string };
  audio?: { id: string; mime_type?: string };
  document?: { id: string; mime_type?: string };
  sticker?: { id: string; mime_type?: string };
  interactive?: unknown;
}

function mapMetaMessageType(type: string): MessageType {
  const map: Record<string, MessageType> = {
    text: "TEXT",
    image: "IMAGE",
    video: "VIDEO",
    audio: "AUDIO",
    document: "DOCUMENT",
    sticker: "STICKER",
    location: "LOCATION",
    contacts: "CONTACTS",
    interactive: "INTERACTIVE",
    button: "BUTTON",
    reaction: "REACTION",
  };
  return map[type] ?? "UNSUPPORTED";
}

function mapMetaMessageStatus(status: string): NormalizedStatusEvent["status"] {
  const map: Record<string, NormalizedStatusEvent["status"]> = {
    sent: "SENT",
    delivered: "DELIVERED",
    read: "READ",
    failed: "FAILED",
  };
  // NormalizedStatusEvent has no PENDING member (context.md §8.0.2) —
  // "sent" is the earliest real status Meta's own webhook reports, so an
  // unrecognized status falls back to that rather than inventing a status
  // this type doesn't have.
  return map[status] ?? "SENT";
}

function extractMediaRef(msg: MetaInboundMessage): MediaReference | null {
  const mediaObj = msg.image ?? msg.video ?? msg.audio ?? msg.document ?? msg.sticker;
  if (!mediaObj?.id) return null;
  return { id: mediaObj.id, mimeType: mediaObj.mime_type ?? "application/octet-stream" };
}

function extractInteractive(_msg: MetaInboundMessage): InteractivePayload | null {
  // Meta's real interactive-reply payload shape (button_reply/list_reply,
  // each carrying an id/title) is NOT yet confirmed against live docs — the
  // raw `msg.interactive` is unrelated in shape to our own
  // `InteractivePayload` (context.md §8.0.2), so returning it as-is would
  // be a silent type lie. Deferred to M10's own verification pass rather
  // than guessed here; the message itself still ingests (as its mapped
  // type, with `raw` preserving the original payload for later use).
  return null;
}
