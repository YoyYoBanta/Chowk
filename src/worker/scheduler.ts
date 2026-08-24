/**
 * Periodic jobs the Worker process owns (architecture.md §3/§4 — "scheduled
 * jobs" is explicitly one of this process's responsibilities): template
 * sync (M7) and, as of M9, the stuck-PENDING-message reconciliation pass
 * (architecture.md §7's hardening item). Both follow the same shape — fire
 * once immediately on boot, then on a fixed interval, stoppable on shutdown
 * — so that shape is factored into `startScheduler` below rather than
 * duplicated per job.
 */
import { listOrganizations } from "@/data/organizations";
import { syncTemplatesForAllOrgs } from "@/services/templates/sync";
import { reconcileStuckPendingMessagesForAllOrgs } from "@/services/messages/reconcile-stuck";

export interface Scheduler {
  stop: () => void;
}

/** Fires `tick` once immediately (so a Worker restart doesn't wait a full
 * interval for the first run), then every `intervalMs`. `stop()` is called
 * from `src/worker/index.ts`'s shutdown handler, mirroring how every BullMQ
 * Worker there is `.close()`d on SIGINT/SIGTERM. */
function startScheduler(tick: () => Promise<void>, intervalMs: number): Scheduler {
  void tick();
  const intervalId = setInterval(() => void tick(), intervalMs);
  return { stop: () => clearInterval(intervalId) };
}

const TEMPLATE_SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** implementation-plan.md's M7 task list: syncing "every 15 minutes and on
 * channel connect" — the force-sync route (`POST /api/templates/sync`)
 * covers the on-demand half, this covers the periodic half.
 * `syncTemplatesForChannel` (the on-connect half) is called directly from
 * `src/worker/index.ts`'s `connectActiveChannels()`, not from here. */
export function startTemplateSyncScheduler(): Scheduler {
  return startScheduler(async () => {
    const orgs = await listOrganizations();
    const results = await syncTemplatesForAllOrgs(orgs.map((o) => o.id));
    const total = results.reduce((sum, r) => sum + r.syncedCount, 0);
    console.log(`[worker] template sync: ${total} template(s) across ${results.length} organization(s)`);
  }, TEMPLATE_SYNC_INTERVAL_MS);
}

const STUCK_MESSAGE_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

/** implementation-plan.md's M9 task list: "a scheduled job that flags/
 * re-checks Message rows stuck in PENDING past a timeout" — see
 * src/services/messages/reconcile-stuck.ts for the actual threshold and
 * why it marks FAILED rather than re-enqueuing. */
export function startStuckMessageReconciliationScheduler(): Scheduler {
  return startScheduler(async () => {
    const total = await reconcileStuckPendingMessagesForAllOrgs();
    if (total > 0) {
      console.log(`[worker] reconciliation: marked ${total} stuck PENDING message(s) as FAILED`);
    }
  }, STUCK_MESSAGE_RECONCILIATION_INTERVAL_MS);
}
