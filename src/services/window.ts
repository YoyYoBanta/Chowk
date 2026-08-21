/**
 * The 24-hour service window (context.md §4.1 / §8.0.4 / §10.4): "a contact
 * sending an inbound message opens (or resets) a 24-hour window on that
 * conversation. Inside the window, any free-form message may be sent.
 * Outside it, only an approved template message may be sent."
 *
 * This file is the ONE place `isWindowOpen` is ever computed (this
 * milestone's own brief). Every other call site — the send service, the
 * Baileys adapter's own simulate-window guard, the conversation detail/list
 * API routes, the dashboard's server components — imports from here rather
 * than re-deriving the 24h math themselves. The result is never stored as a
 * column or cached anywhere: it's derived fresh from `Conversation.
 * lastInboundAt` on every read, by design (a cached/stored boolean would go
 * stale the instant it wasn't recomputed, and this value being wrong is
 * exactly the "Phase A shape leaks into the product" failure context.md
 * warns about).
 */

/** 24 hours, in milliseconds — Meta's own service-window duration. */
export const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000;

/** Under 2 hours remaining counts as "closing soon" (context.md §10.2 —
 * "agents plan their day around this"). */
export const CLOSING_SOON_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * `isWindowOpen = lastInboundAt != null && (now - lastInboundAt) < 24h`.
 * Pure, zero-DB, zero-I/O — takes the already-fetched `lastInboundAt`
 * rather than a conversation id, so every caller (service layer, adapter
 * layer, API routes) can reuse the exact same comparison regardless of how
 * they obtained the timestamp.
 *
 * `now` is an optional override purely for testability (boundary cases:
 * exactly-24h, just-under, just-over) — real call sites simply omit it and
 * get `new Date()`.
 */
export function isWindowOpen(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  if (lastInboundAt == null) return false;
  return now.getTime() - lastInboundAt.getTime() < WINDOW_DURATION_MS;
}

/** The full window state a UI needs to render both the open/closed switch
 * and a "closing soon" / countdown display — not just the boolean. */
export interface WindowState {
  isOpen: boolean;
  /** The absolute instant the window closes (or closed), whenever
   * `lastInboundAt` is known — regardless of whether that instant is in the
   * past or future. `null` only when there has never been an inbound
   * message at all (`lastInboundAt == null`), since there is nothing to
   * compute a close time from. */
  closesAt: Date | null;
  /** Milliseconds remaining until `closesAt`, only while the window is
   * still open — `null` once it's closed (there is no "remaining" time for
   * a window that has already closed) or when `lastInboundAt == null`. */
  remainingMs: number | null;
  /** `true` only while the window is open AND has under
   * `CLOSING_SOON_THRESHOLD_MS` remaining (context.md §10.2's "closing
   * soon" indicator threshold). Always `false` once the window is closed —
   * "closing soon" describes an open window that's about to shut, not a
   * window that already has. */
  isClosingSoon: boolean;
}

/**
 * The richer sibling of `isWindowOpen` — same underlying comparison, plus
 * `closesAt`/`remainingMs`/`isClosingSoon` for the composer's countdown text
 * and the conversation list's closing-soon badge (context.md §10.2/§10.4).
 * Same `now` override for testability.
 */
export function getWindowState(lastInboundAt: Date | null, now: Date = new Date()): WindowState {
  if (lastInboundAt == null) {
    return { isOpen: false, closesAt: null, remainingMs: null, isClosingSoon: false };
  }

  const closesAt = new Date(lastInboundAt.getTime() + WINDOW_DURATION_MS);
  const remainingMs = closesAt.getTime() - now.getTime();
  const isOpen = remainingMs > 0;

  return {
    isOpen,
    closesAt,
    remainingMs: isOpen ? remainingMs : null,
    isClosingSoon: isOpen && remainingMs < CLOSING_SOON_THRESHOLD_MS,
  };
}
