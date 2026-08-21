import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { getConversationWithContact } from "@/data/conversations";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * GET /api/conversations/:id — detail: the conversation + its contact.
 * Computed 24h-window state is M5, not built here.
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
