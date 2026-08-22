import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { getConversationWithContact } from "@/data/conversations";
import { getWindowState } from "@/services/window";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * GET /api/conversations/:id — detail: the conversation + its contact,
 * plus the computed 24h service-window state (M5 — context.md §4.1/§10.4).
 * `isWindowOpen`/`closesAt`/`remainingMs` are derived fresh on every
 * request from the real `lastInboundAt` via `src/services/window.ts` — the
 * one place that comparison is computed — never stored or cached. The
 * composer's open/closed state is driven entirely by this server-computed
 * value, never by the client re-deriving it from a possibly-stale
 * timestamp.
 *
 * Tenancy boundary: `getConversationWithContact` scopes its lookup by
 * `organizationId` from the session, so a conversation id belonging to
 * another organization returns null here — and this route turns that into
 * a 404, never leaking whether the id exists at all in some other org.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "GET /api/conversations/:id";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;
  const { id: conversationId } = await context.params;

  logger.info("request start", { organizationId, correlationId, route, conversationId });

  try {
    const conversation = await getConversationWithContact(organizationId, conversationId);
    if (!conversation) {
      logger.info("request end", { organizationId, correlationId, route, conversationId, statusCode: 404 });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const windowState = getWindowState(conversation.lastInboundAt);

    logger.info("request end", { organizationId, correlationId, route, conversationId, statusCode: 200 });
    return NextResponse.json({
      conversation: {
        ...conversation,
        isWindowOpen: windowState.isOpen,
        closesAt: windowState.closesAt,
        remainingMs: windowState.remainingMs,
      },
    });
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "PATCH /api/conversations/:id";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;
  const { id: conversationId } = await context.params;

  logger.info("request start", { organizationId, correlationId, route, conversationId });

  try {
    const body = await request.json();
    
    // We import updateConversation dynamically to avoid circular dependencies if any,
    // or just assume it's imported at the top. I'll add the import later if needed.
    // Actually, I can import it at the top of the file in another chunk.
    const { updateConversation } = await import("@/data/conversations");

    const conversation = await updateConversation(organizationId, conversationId, {
      assignedUserId: body.assignedUserId,
      status: body.status,
    });

    logger.info("request end", { organizationId, correlationId, route, conversationId, statusCode: 200 });
    return NextResponse.json({ conversation });
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
