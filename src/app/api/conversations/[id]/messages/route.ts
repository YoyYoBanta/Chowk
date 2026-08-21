import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { getConversationById } from "@/data/conversations";
import { listMessagesPage, type MessageCursor } from "@/data/messages";
import { decodeCursor, paginationQuerySchema, type PaginationQuery } from "@/lib/validation/pagination";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * GET /api/conversations/:id/messages — paginated, newest-first,
 * cursor-based (context.md §9). The thread UI reverses each page for
 * display; the API itself always returns newest-first so "next page"
 * unambiguously means "older messages".
 *
 * Tenancy: verifies the conversation belongs to the caller's org via
 * `getConversationById` before returning any messages — a conversation id
 * from another org 404s here exactly like the detail route.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "GET /api/conversations/:id/messages";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;
  const { id: conversationId } = await context.params;

  logger.info("request start", { organizationId, correlationId, route, conversationId });

  const conversation = await getConversationById(organizationId, conversationId);
  if (!conversation) {
    logger.info("request end", { organizationId, correlationId, route, conversationId, statusCode: 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const parsedQuery = paginationQuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    logger.warn("request end", { organizationId, correlationId, route, conversationId, statusCode: 400, reason: "invalid query" });
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const query: PaginationQuery = parsedQuery.data;

  let cursor: MessageCursor | undefined;
  if (query.cursor) {
    const decoded = decodeCursor<{ metaTimestamp: string; id: string }>(query.cursor);
    if (!decoded?.metaTimestamp || !decoded.id) {
      logger.warn("request end", { organizationId, correlationId, route, conversationId, statusCode: 400, reason: "invalid cursor" });
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    cursor = { metaTimestamp: new Date(decoded.metaTimestamp), id: decoded.id };
  }

  try {
    const { items, nextCursor } = await listMessagesPage(organizationId, conversationId, {
      limit: query.limit,
      cursor,
    });

    logger.info("request end", {
      organizationId,
      correlationId,
      route,
      conversationId,
      statusCode: 200,
      count: items.length,
    });

    return NextResponse.json({ messages: items, nextCursor });
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
