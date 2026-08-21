import { z } from "zod";

/**
 * Shared cursor-pagination helpers (context.md §9: "Every list endpoint is
 * cursor-paginated. Offset pagination will break as message volume grows.")
 * — used by both `GET /api/conversations` and
 * `GET /api/conversations/:id/messages`.
 *
 * Deliberately generic and opaque to the caller: a cursor is just a
 * base64url-encoded JSON object of string/number fields. Each data-access
 * function (src/data/conversations.ts, src/data/messages.ts) defines its
 * own concrete cursor shape (e.g. `{ lastMessageAt, id }` vs
 * `{ metaTimestamp, id }`) and is responsible for converting its own
 * Date fields to/from ISO strings before calling these — this file only
 * knows about strings and numbers, not domain types.
 */

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function encodeCursor(parts: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

/** Returns null on any malformed cursor rather than throwing — callers
 * should treat that as a 400, not a 500. */
export function decodeCursor<T extends Record<string, string | number>>(
  raw: string,
): T | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
