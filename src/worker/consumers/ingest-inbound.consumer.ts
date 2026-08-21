import type { Prisma } from "@prisma/client";
import { getDownloadMediaQueue, QUEUE_NAMES, type IngestInboundJobData } from "@/queue/queues";
import { findMessageByProviderMessageId, createMessage } from "@/data/messages";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";
import { publishMessageCreated } from "@/services/realtime/publish";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * The transport-agnostic heart of inbound ingestion (architecture.md §6).
 * Both Baileys (Phase A) and, later, the Meta webhook receiver (Phase B)
 * enqueue the identical `IngestInboundJobData` shape onto the
 * `ingest-inbound` queue — this function is the only thing that ever reads
 * that queue, and it does not know or care which transport produced the
 * job.
 *
 * Invariants (must hold exactly, per architecture.md §6 / context.md §8.1b):
 *  1. Dedupe on providerMessageId before any write — a replay is a no-op
 *     past this check (log + return), never a second row.
 *  2. Contact and Conversation are upserts, not inserts — first-contact-
 *     ever must not race a duplicate, and repeat delivery must be a no-op
 *     past the dedupe check above.
 *  3. Never throw. An unrecognized/unmapped type has already been mapped to
 *     MessageType.UNSUPPORTED by the adapter's normalization step by the
 *     time it reaches here (NormalizedInboundEvent.type is already one of
 *     our enum members) — this function's job is to make sure nothing
 *     downstream of that (a malformed body, a null contact name, whatever)
 *     turns into an uncaught exception that would leave the job stuck
 *     retrying forever. Genuine unexpected errors are logged and rethrown
 *     so BullMQ's retry/backoff can do its job — "never throw" here means
 *     never throw on data we can still faithfully persist, not "swallow
 *     real bugs silently."
 *
 * M3 addition: after `createMessage` persists the row, publish a
 * `message.created` realtime event (src/services/realtime/publish.ts) so
 * any SSE-connected browser for this organization sees it live — this is
 * the one meaningful change to this file's own logic this milestone makes.
 *
 * correlationId: generated fresh at the top of this function, not at the
 * job's true origin (the Baileys socket event / webhook receipt). That
 * origin lives in src/providers/, which this milestone's brief explicitly
 * says not to modify beyond an actual bug fix — threading a correlation id
 * through the enqueue call in src/providers/baileys/adapter.ts would be
 * exactly that kind of touch. The id below still covers every log line
 * this milestone actually adds for a given message's processing (dedupe
 * check → contact/conversation upsert → persist → realtime publish), which
 * is the traceable unit of work this milestone is responsible for.
 */
export async function processIngestInboundJob(data: IngestInboundJobData): Promise<void> {
  const { organizationId, provider, event } = data;
  const correlationId = newCorrelationId();

  const existing = await findMessageByProviderMessageId(organizationId, event.providerMessageId);
  if (existing) {
    logger.info("duplicate providerMessageId — skipping, no writes", {
      organizationId,
      correlationId,
      provider,
      providerMessageId: event.providerMessageId,
    });
    return;
  }

  const contact = await upsertContact(organizationId, {
    waId: event.from,
    name: event.contactName,
  });

  const conversation = await upsertConversationForInbound(organizationId, {
    channelId: event.channelId,
    contactId: contact.id,
    occurredAt: event.timestamp,
  });

  const message = await createMessage(organizationId, {
    conversationId: conversation.id,
    provider,
    providerMessageId: event.providerMessageId,
    direction: "INBOUND",
    type: event.type,
    body: event.body,
    // mediaId deliberately NOT set here (M6) — event.media is the
    // PROVIDER's own transient reference (a Baileys download key / a Meta
    // media id), not a row in our `Media` table. That row doesn't exist
    // yet; it's created by the download-media job enqueued just below,
    // which links Message.mediaId once the bytes are actually downloaded
    // and stored (src/services/media/download-and-store.ts). Setting
    // mediaId to the provider's own ephemeral id here would silently break
    // every mediaId-scoped lookup in src/data/media.ts.
    interactivePayload: event.interactive ? toJson(event.interactive) : undefined,
    rawPayload: toJson(event.raw),
    metaTimestamp: event.timestamp,
  });

  // M6 (architecture.md §8, §6): enqueued in the SAME TICK as the message
  // insert, never lazily — Meta's media download URLs are short-lived
  // (context.md §4.4), so waiting until an agent opens the chat risks
  // permanent loss.
  if (event.media) {
    await getDownloadMediaQueue().add(QUEUE_NAMES.downloadMedia, {
      organizationId,
      provider,
      channelId: event.channelId,
      messageId: message.id,
      mediaRef: event.media,
    });
  }

  logger.info("message ingested", {
    organizationId,
    correlationId,
    conversationId: conversation.id,
    contactId: contact.id,
    messageId: message.id,
    provider,
    providerMessageId: event.providerMessageId,
    messageType: message.type,
    hasMedia: event.media != null,
  });

  await publishMessageCreated(organizationId, conversation.id, message, { correlationId });
}

/**
 * `NormalizedInboundEvent.raw` is `unknown` by design ("always preserve the
 * original payload") and, coming from Baileys, may contain values Prisma's
 * Json type can't take as-is (Buffers, protobufjs Longs, etc.). A
 * stringify/parse round trip is how every one of those gets coerced into
 * something JSON-safe using their own `toJSON`/`toString` where defined;
 * on genuine failure (e.g. a circular structure) we still persist
 * *something* rather than let raw-payload preservation crash ingestion —
 * see invariant 3 above.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  } catch (error) {
    return {
      unserializable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
