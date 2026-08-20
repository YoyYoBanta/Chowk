import { redirect } from "next/navigation";
import { getCurrentSession, type SessionData } from "./session";
import type { Role } from "@prisma/client";

/**
 * Shared role-gate helpers, called from the `(dashboard)` route group's
 * layout (and, for the extra ADMIN-only check, from the placeholder
 * admin-only page). Layout-level checks rather than middleware: the data
 * layer (and therefore Prisma) has to run in the Node runtime, and this
 * keeps the session/DB lookups in one place instead of duplicating them
 * across an Edge middleware AND every server component.
 */

/** Redirects to /login if there is no session. Otherwise returns it. */
export async function requireSession(): Promise<SessionData> {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Redirects to /login if there is no session, or to the dashboard home if
 * the session's role doesn't match. Otherwise returns the session.
 */
export async function requireRole(role: Role): Promise<SessionData> {
  const session = await requireSession();
  if (session.role !== role) {
    redirect("/dashboard");
  }
  return session;
}
