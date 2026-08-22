import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { logger, newCorrelationId } from "@/lib/logging/logger";
import { syncTemplatesForOrg } from "@/services/templates/sync";

/**
 * POST /api/templates/sync — force sync (context.md §9). Delegates to
 * `src/services/templates/sync.ts`'s `syncTemplatesForOrg`, the same
 * implementation `src/worker/scheduler.ts`'s periodic sweep uses — this
 * route covers the force-sync half of M7's task list, the scheduler covers
 * the periodic half ("every 15 minutes and on channel connect").
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "POST /api/templates/sync";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;

  logger.info("request start", { organizationId, correlationId, route });

  try {
    const syncedCount = await syncTemplatesForOrg(organizationId);
    logger.info("request end", { organizationId, correlationId, route, statusCode: 200, count: syncedCount });
    return NextResponse.json({ success: true, syncedCount });
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
