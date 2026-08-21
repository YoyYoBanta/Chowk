import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { listConversationsPage } from "@/data/conversations";
import { decodeCursor, paginationQuerySchema, type PaginationQuery } from "@/lib/validation/pagination";
import { messagePreviewText } from "@/lib/messages/render";
import { getWindowState } from "@/services/window";
import { logger, newCorrelationId } from "@/lib/logging/logger";
import type { ConversationCursor } from "@/data/conversations";

/**
 * GET /api/conversations — list, cursor-paginated by (lastMessageAt, id),
 * most-recent-first (context.md §9). Filters (status/assignedTo/channelId/
 * tag/search) are M8/M9 — not built here. `organizationId` comes only from
 * the session (architecture.md §12) — never a query param.
 *
 * M5 addition: each row carries a server-computed `isClosingSoon` boolean
 * (context.md §10.2 — "a subtle indicator when a conversation's 24-hour
 * window is closing soon, under 2 hours") derived from `lastInboundAt` via
 * `src/services/window.ts`'s `getWindowState` — computed here, not
 * re-derived client-side from the raw timestamp also present on the row.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "GET /api/conversations";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;

  logger.info("request start", { organizationId, correlationId, route });

  const url = new URL(request.url);
  const parsedQuery = paginationQuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    logger.warn("request end", { organizationId, correlationId, route, statusCode: 400, reason: "invalid query" });
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const query: PaginationQuery = parsedQuery.data;

  let cursor: ConversationCursor | undefined;
  if (query.cursor) {
    const decoded = decodeCursor<{ lastMessageAt: string; id: string }>(query.cursor);
    if (!decoded?.lastMessageAt || !decoded.id) {
      logger.warn("request end", { organizationId, correlationId, route, statusCode: 400, reason: "invalid cursor" });
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    cursor = { lastMessageAt: new Date(decoded.lastMessageAt), id: decoded.id };
  }

  try {
    const { items, nextCursor } = await listConversationsPage(organizationId, {
      limit: query.limit,
      cursor,
    });

    const conversations = items.map((conversation) => {
      const lastMessage = conversation.messages[0] ?? null;
      return {
        id: conversation.id,
        status: conversation.status,
        unreadCount: conversation.unreadCount,
        lastMessageAt: conversation.lastMessageAt,
        lastInboundAt: conversation.lastInboundAt,
        isClosingSoon: getWindowState(conversation.lastInboundAt).isClosingSoon,
        contact: {
          id: conversation.contact.id,
          name: conversation.contact.name,
          displayName: conversation.contact.displayName,
          waId: conversation.contact.waId,
        },
        channel: conversation.channel,
        lastMessagePreview: lastMessage ? messagePreviewText(lastMessage) : null,
        lastMessageDirection: lastMessage?.direction ?? null,
      };
    });

    logger.info("request end", { organizationId, correlationId, route, statusCode: 200, count: conversations.length });

    return NextResponse.json({ conversations, nextCursor });
  } catch (error) {
    logger.error("request failed", {
      organizationId,
      correlationId,
      route,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
