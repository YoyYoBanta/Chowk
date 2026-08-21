import type { NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { subscribeToOrgEvents } from "@/services/realtime/publish";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * GET /api/events — the SSE endpoint (architecture.md §4's
 * `api/events/route.ts`, §11). Subscribes the caller's ONE connection to
 * the Redis pub/sub channel for their `organizationId` — read from the
 * session (`requireApiSession`), never a query param, so there is no way
 * to ask this endpoint for another organization's events. This is the
 * tenancy boundary for realtime, held to the same standard as the
 * data-access layer's `organizationId`-first rule.
 *
 * `force-dynamic`: this response must never be cached/statically
 * optimized — every connection is a live, per-caller stream.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;

  const correlationId = newCorrelationId();
  const route = "GET /api/events";
  logger.info("sse connection opened", { organizationId, correlationId, route });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let subscription: Awaited<ReturnType<typeof subscribeToOrgEvents>> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed (client disconnected) — nothing to do.
        }
      };

      // Subscribe FIRST, then emit the "connected" comment — not the other
      // way round. Redis pub/sub has no replay/persistence: a publish that
      // happens before SUBSCRIBE has actually registered with Redis is
      // simply missed by this connection. Emitting the comment only once
      // `subscribeToOrgEvents` has resolved gives a caller (a real
      // browser, or the integration test) a reliable signal that "this
      // connection will now see any event published from this point
      // forward" — before that, there's nothing meaningful to read yet.
      subscription = await subscribeToOrgEvents(organizationId, (raw) => {
        safeEnqueue(`data: ${raw}\n\n`);
      });

      // Comment line (per the SSE spec, a line starting with `:` is
      // ignored by EventSource but keeps the connection alive/observable).
      safeEnqueue(`: connected\n\n`);

      // Heartbeat comment every 15s. EventSource's own auto-reconnect
      // handles a genuinely dropped connection; this just makes a
      // half-open/idle connection observable rather than silently stalled.
      heartbeat = setInterval(() => safeEnqueue(`: heartbeat\n\n`), 15_000);
    },
    async cancel() {
      closed = true;
      logger.info("sse connection closed", { organizationId, correlationId, route });
      if (heartbeat) clearInterval(heartbeat);
      await subscription?.unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Correlation-Id": correlationId,
    },
  });
}
