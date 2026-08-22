/**
 * Periodic jobs the Worker process owns (architecture.md §3/§4 — "scheduled
 * jobs" is explicitly one of this process's responsibilities). Currently
 * just template sync: implementation-plan.md's M7 task list calls for
 * syncing "every 15 minutes and on channel connect" — the force-sync route
 * (`POST /api/templates/sync`) covered the on-demand half; this covers the
 * periodic half. `syncTemplatesForChannel` (the on-connect half) is called
 * directly from `src/worker/index.ts`'s `connectActiveChannels()`, not from
 * here.
 */
import { listOrganizations } from "@/data/organizations";
import { syncTemplatesForAllOrgs } from "@/services/templates/sync";

const TEMPLATE_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export interface TemplateSyncScheduler {
  stop: () => void;
}

/** Starts the periodic sweep. Fires once immediately (so a Worker restart
 * doesn't wait 15 minutes for the first sync), then every 15 minutes.
 * `stop()` is called from `src/worker/index.ts`'s shutdown handler,
 * mirroring how every BullMQ Worker there is `.close()`d on SIGINT/SIGTERM. */
export function startTemplateSyncScheduler(): TemplateSyncScheduler {
  const tick = async (): Promise<void> => {
    const orgs = await listOrganizations();
    const results = await syncTemplatesForAllOrgs(orgs.map((o) => o.id));
    const total = results.reduce((sum, r) => sum + r.syncedCount, 0);
    console.log(`[worker] template sync: ${total} template(s) across ${results.length} organization(s)`);
  };

  void tick();
  const intervalId = setInterval(() => void tick(), TEMPLATE_SYNC_INTERVAL_MS);

  return {
    stop: () => clearInterval(intervalId),
  };
}
