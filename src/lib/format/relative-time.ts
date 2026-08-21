/**
 * Small, dependency-free relative-time formatter for the conversation
 * list/thread UI (context.md §10.2 — "relative timestamp"). Deliberately
 * not pulling in a date library for one function.
 */
export function formatRelativeTime(date: Date | string | null, now: Date = new Date()): string {
  if (!date) return "";
  const then = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return then.toLocaleDateString();
}
