import { getWhatsAppProvider } from "@/providers/factory";
import { listChannelsInOrg } from "@/data/channels";
import { upsertTemplateFromSync } from "@/data/templates";
import { logger } from "@/lib/logging/logger";

/**
 * The one real sync implementation — calls `provider.listTemplates()` per
 * channel and upserts locally (architecture.md §9's sequence). Shared by
 * `POST /api/templates/sync` (the force-sync half of M7's task list) and
 * `src/worker/scheduler.ts` (the periodic half, "every 15 minutes and on
 * channel connect" per implementation-plan.md) so the two don't drift into
 * two different sync implementations.
 */
export async function syncTemplatesForOrg(organizationId: string): Promise<number> {
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
  return syncedCount;
}

/** Same sync, scoped to one already-known channel — used right after a
 * channel connects (`src/worker/index.ts`'s `connectActiveChannels()`),
 * where re-listing every channel in the org would be wasted work. */
export async function syncTemplatesForChannel(organizationId: string, channelId: string): Promise<number> {
  const provider = getWhatsAppProvider();
  const templates = await provider.listTemplates(channelId);
  for (const t of templates) {
    await upsertTemplateFromSync(organizationId, channelId, {
      name: t.name,
      language: t.languageCode,
      category: t.category,
      status: t.status,
      components: { body: t.body },
    });
  }
  return templates.length;
}

/** Every org, every channel — the scheduler's periodic tick. Failures on
 * one org/channel are logged and skipped, never allowed to stop the sweep
 * partway through (the same "a failure here must not take down the whole
 * process" discipline `connectActiveChannels()` already applies per-channel). */
export async function syncTemplatesForAllOrgs(
  organizationIds: string[],
): Promise<{ organizationId: string; syncedCount: number }[]> {
  const results: { organizationId: string; syncedCount: number }[] = [];
  for (const organizationId of organizationIds) {
    try {
      const syncedCount = await syncTemplatesForOrg(organizationId);
      results.push({ organizationId, syncedCount });
    } catch (error) {
      logger.error("template sync failed for organization", {
        organizationId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
