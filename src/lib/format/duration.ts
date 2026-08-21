/**
 * Small, dependency-free duration formatter — used by the composer's
 * "Window closes in Xh Ym" countdown text (context.md §10.4). Sibling to
 * relative-time.ts's same "no date library for one function" approach.
 */
export function formatDurationShort(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0 && minutes === 0) return "less than a minute";
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
