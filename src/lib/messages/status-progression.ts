import type { MessageStatus } from "@prisma/client";

/**
 * The one place message-status forward-only ordering is computed
 * (context.md §13 / architecture.md §10 name this exact logic as a
 * correctness-bug hotspot: "status webhooks arrive out of order... never
 * downgrade a status"). A small, explicit, directly-unit-testable ranking
 * function rather than an ad-hoc if/else chain — see status-progression.test.ts.
 *
 * Kept in src/lib/messages/ (alongside the existing pure, side-effect-free
 * render.ts) rather than src/data/ or src/services/ specifically so it has
 * zero Prisma/queue/provider imports and can be exercised by the fast
 * Vitest suite with no DB — same reasoning as src/providers/baileys/normalize.ts
 * being split out from adapter.ts.
 *
 * ## Where FAILED sits, and why it moved (2026-09-09)
 *
 * FAILED ranks between SENT and DELIVERED. The rank is "how far the message
 * actually got", and FAILED means "got no further than sent" — so it is a
 * valid forward target from PENDING and SENT, but **not** from DELIVERED or
 * READ.
 *
 * It previously ranked above everything (PENDING < SENT < DELIVERED < READ <
 * FAILED), which made FAILED reachable from any state and terminal for free.
 * That was written for Baileys, where a failure is something our own send
 * path observes once, and it was correct there.
 *
 * It is wrong for Meta. The Cloud API can emit BOTH `delivered` and `failed`
 * webhooks for a single message when the recipient is logged in on several
 * devices and delivery succeeds on one but not another (confirmed against
 * Meta's status webhook reference, 2026-09-09 — see TODO-VERIFY.md). Under
 * the old ranking a late `failed` outranked the `delivered` that preceded it,
 * so a message the recipient had genuinely received would be shown to the
 * agent as failed — and, because FAILED was terminal, permanently so.
 *
 * The rule this encodes now: **delivery is a positive fact and is not
 * retracted by a later failure on some other device.** Once we have evidence
 * the message reached the recipient, that evidence wins.
 *
 * Three consequences worth being explicit about, since this is a deliberate
 * departure from the old behaviour rather than an oversight:
 *
 * 1. FAILED is no longer terminal. DELIVERED and READ both outrank it, so a
 *    `delivered` arriving after a `failed` (the same multi-device race, in
 *    the other webhook order — Meta does not guarantee ordering) correctly
 *    upgrades the message. This is the intended behaviour, not a regression:
 *    both orderings now converge on DELIVERED, which is what actually
 *    happened.
 * 2. A genuine terminal failure is unaffected. A message that never left
 *    PENDING or SENT still moves to FAILED, and nothing subsequently arrives
 *    to move it off — there is no delivery receipt for a message that was
 *    never delivered. The paths that write FAILED directly
 *    (send-message.consumer.ts's terminal/exhausted branches,
 *    reconcile-stuck.ts) all act on PENDING rows, so all of them remain
 *    forward moves.
 * 3. SENT still cannot overwrite FAILED (rank 1 < 2), so a duplicate or
 *    replayed `sent` webhook after a real failure is still ignored.
 *
 * This narrows context.md §7.4's "or into FAILED" to "or into FAILED, from
 * PENDING/SENT only". §7.4 predates Phase B and was written against Baileys'
 * semantics; the multi-device case it does not cover is the reason for the
 * change.
 */
const STATUS_RANK: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  FAILED: 2,
  DELIVERED: 3,
  READ: 4,
};

export function statusRank(status: MessageStatus): number {
  return STATUS_RANK[status];
}

/** True iff `next` is strictly forward of `current` in the progression —
 * the single predicate both the status-update consumer and its tests
 * exercise directly. */
export function isForwardStatusTransition(current: MessageStatus, next: MessageStatus): boolean {
  return statusRank(next) > statusRank(current);
}

/**
 * Every status whose rank is strictly below `target`'s — i.e. the set of
 * "current" statuses from which transitioning TO `target` is a forward
 * move. Used to build an atomic, race-free conditional UPDATE
 * (`WHERE status IN (...)`) in src/data/messages.ts's
 * `applyForwardOnlyMessageStatus`, instead of a read-then-write pair that
 * would leave a window for a concurrent writer to slip in between the
 * read and the write.
 */
export function statusesBelow(target: MessageStatus): MessageStatus[] {
  const targetRank = statusRank(target);
  return (Object.keys(STATUS_RANK) as MessageStatus[]).filter((s) => STATUS_RANK[s] < targetRank);
}
