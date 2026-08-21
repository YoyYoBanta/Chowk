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
 * FAILED is deliberately ranked ABOVE every other status, not handled as a
 * special-cased "terminal" branch — this is what makes it a valid forward
 * target from ANY non-FAILED state (PENDING, SENT, DELIVERED, or even
 * READ), matching context.md §7.4 ("Status only ever moves forward:
 * PENDING -> SENT -> DELIVERED -> READ, or into FAILED") and this
 * milestone's own test brief: "a FAILED after SENT applies (still forward,
 * since FAILED is terminal from any non-terminal state)". Ranking it
 * highest also makes FAILED terminal for free — once a message is FAILED,
 * no other status outranks it, so nothing can ever move past it again; no
 * separate `current === "FAILED"` special case is needed anywhere that
 * calls isForwardStatusTransition/statusesBelow.
 */
const STATUS_RANK: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
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
