import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { markConversationRead } from "@/services/messages/mark-read";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * POST /api/conversations/:id/read (context.md §9/§8.2): calls the
 * provider's mark-as-read for the conversation's latest inbound message
 * and resets `unreadCount` locally — the actual logic lives in
 * src/services/messages/mark-read.ts, including the "never fail the whole
 * request just because the provider call failed" rule (context.md §8.2).
 * This route only does tenancy/session plumbing + logging, same
 * conventions as every other route under src/app/api/conversations/.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "POST /api/conversations/:id/read";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;
  const { id: conversationId } = await context.params;

  logger.info("request start", { organizationId, correlationId, route, conversationId });

  try {
    const result = await markConversationRead(organizationId, conversationId, { correlationId });

    if (!result.ok) {
      logger.info("request end", {
        organizationId,
        correlationId,
        route,
        conversationId,
        statusCode: result.status,
      });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logger.info("request end", { organizationId, correlationId, route, conversationId, statusCode: 200 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("request failed", {
      organizationId,
      correlationId,
      route,
      conversationId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
