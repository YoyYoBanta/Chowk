import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/guard";
import { getConversationById } from "@/data/conversations";
import { listMessagesPage, type MessageCursor } from "@/data/messages";
import { decodeCursor, paginationQuerySchema, type PaginationQuery } from "@/lib/validation/pagination";
import { sendTextMessage } from "@/services/messages/send-message";
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

/**
 * POST /api/conversations/:id/messages — send a text message
 * (context.md §9; architecture.md §7's full sequence lives in
 * src/services/messages/send-message.ts, this route only validates the
 * body and delegates). Text-only this milestone: media/template sends
 * are M6/M7, so the schema below has no `type`/`mediaId`/`templateName`
 * fields at all — a body carrying them is simply ignored (zod strips
 * unknown keys by default), never half-interpreted as a media/template
 * send.
 *
 * 24-hour window enforcement (M5): `sendTextMessage` itself checks the
 * window BEFORE creating any row (src/services/window.ts /
 * src/services/messages/send-message.ts's own doc comment) and returns a
 * structured rejection rather than throwing. This route only translates
 * that into the actual HTTP response — a window-closed send comes back as
 * a real `409` with `{ error, code: "WINDOW_CLOSED" }`, so a direct API
 * call (not just the UI) is rejected exactly the same way the UI's own
 * disabled composer state prevents in the first place (context.md's M5
 * done-criterion: "a direct API call bypassing the UI is rejected with a
 * structured error").
 *
 * Returns 202 (accepted, not yet delivered) with the PENDING message row —
 * matching architecture.md §7's sequence diagram exactly ("Svc-->>API: 202
 * { messageId, status: PENDING }").
 */
const sendMessageBodySchema = z.object({
  body: z.string().trim().min(1, "Message body cannot be empty").max(4096),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "POST /api/conversations/:id/messages";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId, userId } = auth.session;
  const { id: conversationId } = await context.params;

  logger.info("request start", { organizationId, correlationId, route, conversationId, userId });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    logger.warn("request end", {
      organizationId,
      correlationId,
      route,
      conversationId,
      statusCode: 400,
      reason: "invalid json",
    });
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = sendMessageBodySchema.safeParse(json);
  if (!parsed.success) {
    logger.warn("request end", {
      organizationId,
      correlationId,
      route,
      conversationId,
      statusCode: 400,
      reason: "invalid body",
    });
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await sendTextMessage(
      { organizationId, conversationId, userId, body: parsed.data.body },
      { correlationId },
    );

    if (!result.ok) {
      logger.info("request end", {
        organizationId,
        correlationId,
        route,
        conversationId,
        statusCode: result.status,
        ...("code" in result ? { errorCode: result.code } : {}),
      });
      return NextResponse.json(
        { error: result.error, ...("code" in result ? { code: result.code } : {}) },
        { status: result.status },
      );
    }

    logger.info("request end", {
      organizationId,
      correlationId,
      route,
      conversationId,
      statusCode: 202,
      messageId: result.message.id,
    });
    return NextResponse.json({ message: result.message }, { status: 202 });
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
