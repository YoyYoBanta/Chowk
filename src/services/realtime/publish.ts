import IORedis from "ioredis";
import type { Message } from "@prisma/client";
import { env } from "@/config/env";
import { logger } from "@/lib/logging/logger";

/**
 * Realtime fan-out for the SSE endpoint (architecture.md §11,
 * `src/services/realtime/publish.ts` in the repo layout at architecture.md
 * §4). A second, dedicated Redis connection — deliberately NOT the shared
 * `redisConnection` from src/queue/connection.ts, and not shared with any
 * single subscriber connection either:
 *
 *  - Once an ioredis connection issues `SUBSCRIBE`, it can only issue
 *    further pub/sub commands on that connection (this is a Redis protocol
 *    rule, not an ioredis limitation) — so a connection used to publish
 *    can never also be used to subscribe, and vice versa.
 *  - `GET /api/events` (src/app/api/events/route.ts) opens one NEW
 *    subscriber connection per SSE client, scoped to that one connection's
 *    lifetime, so one dropped/slow browser tab can't affect any other
 *    tab's stream. The publisher connection below is a single shared
 *    singleton instead, since publishing is a fire-and-forget command that
 *    many callers can safely share one connection for.
 *
 * Channel naming keys by organizationId (`chowk:realtime:org:<id>`) rather
 * than a single fan-out channel filtered client-side — per
 * architecture.md §11, this is "the safer default" because it means a
 * cross-tenant event never even reaches the transport layer for the wrong
 * org's SSE connection, rather than relying on every subscriber to filter
 * correctly.
 */

export interface MessageCreatedEvent {
  type: "message.created";
  organizationId: string;
  conversationId: string;
  message: Message;
}

export function realtimeChannelForOrg(organizationId: string): string {
  return `chowk:realtime:org:${organizationId}`;
}

let publisher: IORedis | undefined;

function getPublisher(): IORedis {
  if (!publisher) {
    // lazyConnect, same reasoning as src/queue/connection.ts: this module
    // is reachable (transitively) from the fast Vitest suite's module
    // graph, which must never touch the network on a bare import — only
    // an actual publishInline call does.
    publisher = new IORedis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
    publisher.on("error", (err) => {
      logger.error("realtime publisher redis error", { errorMessage: err.message });
    });
  }
  return publisher;
}

/**
 * Publishes a `message.created` event for one persisted Message. Called by
 * the ingest-inbound consumer immediately after `createMessage` (the one
 * meaningful addition to that existing M2 file this milestone makes).
 * Never throws past this function — a realtime-publish failure must not
 * fail the job that already durably persisted the message; SSE is a
 * convenience channel, not the source of truth (architecture.md §11), so a
 * dropped publish just means the client falls back to its own next
 * reconcile-by-refetch.
 */
export async function publishMessageCreated(
  organizationId: string,
  conversationId: string,
  message: Message,
  fields: { correlationId?: string } = {},
): Promise<void> {
  const event: MessageCreatedEvent = {
    type: "message.created",
    organizationId,
    conversationId,
    message,
  };

  try {
    await getPublisher().publish(realtimeChannelForOrg(organizationId), JSON.stringify(event));
    logger.info("published realtime event", {
      organizationId,
      conversationId,
      messageId: message.id,
      correlationId: fields.correlationId,
      route: "realtime.publish",
    });
  } catch (error) {
    logger.error("failed to publish realtime event", {
      organizationId,
      conversationId,
      messageId: message.id,
      correlationId: fields.correlationId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface OrgEventSubscription {
  unsubscribe: () => Promise<void>;
}

/**
 * Subscribes a brand-new Redis connection to one organization's realtime
 * channel. Called once per SSE connection (src/app/api/events/route.ts) —
 * never a pattern-subscribe across all orgs, so there is no cross-tenant
 * fan-out to filter at this layer at all.
 */
export async function subscribeToOrgEvents(
  organizationId: string,
  onEvent: (raw: string) => void,
): Promise<OrgEventSubscription> {
  const channel = realtimeChannelForOrg(organizationId);
  const subscriber = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  subscriber.on("error", (err) => {
    logger.error("realtime subscriber redis error", { organizationId, errorMessage: err.message });
  });
  subscriber.on("message", (channelName, message) => {
    if (channelName === channel) onEvent(message);
  });

  await subscriber.subscribe(channel);

  return {
    unsubscribe: async () => {
      try {
        await subscriber.unsubscribe(channel);
      } catch {
        // best-effort — we're about to quit the connection anyway.
      }
      await subscriber.quit().catch(() => subscriber.disconnect());
    },
  };
}
