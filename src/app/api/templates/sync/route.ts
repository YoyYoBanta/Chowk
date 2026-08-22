import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { logger, newCorrelationId } from "@/lib/logging/logger";
import { getWhatsAppProvider } from "@/providers/factory";
import { listChannelsInOrg } from "@/data/channels";
import { upsertTemplateFromSync } from "@/data/templates";

/**
 * POST /api/templates/sync — force sync (context.md §9). Calls
 * `provider.listTemplates()` per channel and upserts locally
 * (architecture.md §9's sequence) — for Baileys/Phase A this reads back
 * whatever's already in our own `Template` table (context.md §8.0.4's
 * `simulate-templates.ts`), so a force-sync is a genuine no-op in terms of
 * data change, but it exercises the real call path rather than
 * short-circuiting it — the same abstraction-holds principle M2's stub
 * cloud-api provider was built to prove.
 *
 * Not wired to a scheduled job yet (implementation-plan.md's
 * `src/worker/scheduler.ts` "every 15 minutes and on channel connect" is
 * still open — this route covers the force-sync half of M7's task list,
 * not the periodic half).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "POST /api/templates/sync";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;

  logger.info("request start", { organizationId, correlationId, route });

  try {
    const channels = await listChannelsInOrg(organizationId);
    const provider = getWhatsAppProvider();

    let syncedCount = 0;
    for (const channel of channels) {
      const templates = await provider.listTemplates(channel.id);
      for (const t of templates) {
        await upsertTemplateFromSync(organizationId, channel.id, {
          name: t.name,
          language: t.languageCode,
          category: t.category,
          status: t.status,
          components: { body: t.body },
        });
        syncedCount += 1;
      }
    }

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
