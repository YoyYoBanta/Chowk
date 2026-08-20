import type { Prisma } from "@prisma/client";
import type { IngestInboundJobData } from "@/queue/queues";
import { findMessageByProviderMessageId, createMessage } from "@/data/messages";
import { upsertContact } from "@/data/contacts";
import { upsertConversationForInbound } from "@/data/conversations";

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
 */
export async function processIngestInboundJob(data: IngestInboundJobData): Promise<void> {
  const { organizationId, provider, event } = data;

  const existing = await findMessageByProviderMessageId(organizationId, event.providerMessageId);
  if (existing) {
    console.log(
      `[ingest-inbound] duplicate providerMessageId=${event.providerMessageId} (provider=${provider}, org=${organizationId}) — skipping, no writes`,
    );
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

  await createMessage(organizationId, {
    conversationId: conversation.id,
    provider,
    providerMessageId: event.providerMessageId,
    direction: "INBOUND",
    type: event.type,
    body: event.body,
    mediaId: event.media?.id ?? null,
    interactivePayload: event.interactive ? toJson(event.interactive) : undefined,
    rawPayload: toJson(event.raw),
    metaTimestamp: event.timestamp,
  });
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
