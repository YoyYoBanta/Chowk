import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { listChannelsInOrg } from "@/data/channels";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * GET /api/channels — admin only (context.md §9). Backs the admin channels
 * screen (src/app/(dashboard)/dashboard/admin/channels/page.tsx), which
 * was fetching this route before it existed. Quality rating / messaging
 * tier are returned as-is from the `Channel` row — read directly from
 * whatever Meta sync last wrote there, never computed locally (context.md
 * §4.3), which for Phase A is simply `null` until a real M9 sync job
 * exists.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "GET /api/channels";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId, role } = auth.session;

  if (role !== "ADMIN") {
    logger.warn("request end", { organizationId, correlationId, route, statusCode: 403 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  logger.info("request start", { organizationId, correlationId, route });

  try {
    const channels = await listChannelsInOrg(organizationId);
    logger.info("request end", { organizationId, correlationId, route, statusCode: 200, count: channels.length });
    return NextResponse.json({ channels });
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
