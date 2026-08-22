import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/guard";
import { getConversationById } from "@/data/conversations";
import { listMessagesPage, type MessageCursor } from "@/data/messages";
import { attachMediaSummaries, attachMediaSummary } from "@/data/media";
import { decodeCursor, paginationQuerySchema, type PaginationQuery } from "@/lib/validation/pagination";
import { sendMediaMessage, sendTextMessage, sendTemplateMessage, type SendMessageResult } from "@/services/messages/send-message";
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

  const search = url.searchParams.get("search") || undefined;

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
      search,
    });
    // M6: attach each message's media summary (null if it has none, or has
    // media still downloading — src/services/media/download-and-store.ts)
    // — one batched query for the whole page (src/data/media.ts's
    // attachMediaSummaries), not one per message.
    const messages = await attachMediaSummaries(organizationId, items);

    logger.info("request end", {
      organizationId,
      correlationId,
      route,
      conversationId,
      statusCode: 200,
      count: messages.length,
    });

    return NextResponse.json({ messages, nextCursor });
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
 * POST /api/conversations/:id/messages — send a message: text (JSON body)
 * or media (multipart/form-data) — context.md §9's single documented route
 * for "send (text | media | template)". Content-Type dispatches which:
 *  - `application/json` — the M4/M5 text path, unchanged.
 *  - `multipart/form-data` — M6: a `file` field (the attachment) and an
 *    optional `caption` field. No `type` is sent by the client; the
 *    message's MessageType is derived server-side from the file's MIME
 *    type (src/services/media/limits.ts), never trusted from the request.
 *
 * Both paths delegate to src/services/messages/send-message.ts, which is
 * where the real sequence (window check → PENDING row → enqueue) lives —
 * this route only validates the request shape and translates the result
 * into HTTP.
 *
 * 24-hour window enforcement (M5, unchanged, applies to media too —
 * context.md §4.1: media is a free-form send): a window-closed rejection
 * comes back as a real `409` with `{ error, code: "WINDOW_CLOSED" }` for
 * either path, so a direct API call is rejected exactly the same way the
 * UI's disabled composer state prevents in the first place.
 *
 * Returns 202 (accepted, not yet delivered) with the PENDING message row,
 * enriched with its media summary (src/data/media.ts's attachMediaSummary
 * — null for a text send, or for a media send whose Media row was just
 * created a moment earlier in this same request) — matching
 * architecture.md §7's sequence diagram ("Svc-->>API: 202 { messageId,
 * status: PENDING }").
 */
const sendMessageBodySchema = z.union([
  z.object({
    type: z.literal("text").optional(),
    body: z.string().trim().min(1, "Message body cannot be empty").max(4096),
  }),
  z.object({
    type: z.literal("template"),
    templateName: z.string().min(1),
    languageCode: z.string().min(1),
    // Zod 4's z.record() requires both the key and value schema explicitly
    // (Zod 3 inferred a string key) — z.record(z.string()) alone silently
    // widened to Record<string, unknown> and broke the type downstream at
    // the sendTemplateMessage() call below.
    variables: z.record(z.string(), z.string()),
  }),
]);

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

  const contentType = request.headers.get("content-type") ?? "";

  let result: SendMessageResult;
  try {
    if (contentType.startsWith("multipart/form-data")) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        logger.warn("request end", {
          organizationId, correlationId, route, conversationId, statusCode: 400, reason: "invalid form data",
        });
        return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        logger.warn("request end", {
          organizationId, correlationId, route, conversationId, statusCode: 400, reason: "missing file",
        });
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }
      const captionRaw = form.get("caption");
      const caption = typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim() : null;

      const buffer = Buffer.from(await file.arrayBuffer());
      result = await sendMediaMessage(
        {
          organizationId,
          conversationId,
          userId,
          file: buffer,
          mimeType: file.type || "application/octet-stream",
          fileName: file.name || null,
          caption,
        },
        { correlationId },
      );
    } else {
      let json: unknown;
      try {
        json = await request.json();
      } catch {
        logger.warn("request end", {
          organizationId, correlationId, route, conversationId, statusCode: 400, reason: "invalid json",
        });
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      const parsed = sendMessageBodySchema.safeParse(json);
      if (!parsed.success) {
        logger.warn("request end", {
          organizationId, correlationId, route, conversationId, statusCode: 400, reason: "invalid body",
        });
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
      }

      if (parsed.data.type === "template") {
        result = await sendTemplateMessage(
          {
            organizationId,
            conversationId,
            userId,
            templateName: parsed.data.templateName,
            languageCode: parsed.data.languageCode,
            variables: parsed.data.variables,
          },
          { correlationId },
        );
      } else {
        result = await sendTextMessage(
          { organizationId, conversationId, userId, body: parsed.data.body },
          { correlationId },
        );
      }
    }

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

    const enriched = await attachMediaSummary(organizationId, result.message);
    logger.info("request end", {
      organizationId,
      correlationId,
      route,
      conversationId,
      statusCode: 202,
      messageId: result.message.id,
    });
    return NextResponse.json({ message: enriched }, { status: 202 });
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
