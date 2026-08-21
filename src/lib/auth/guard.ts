import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentSession, getSessionFromRequest, type SessionData } from "./session";
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

/**
 * M3 addition: the API-route counterpart to `requireSession()`. Route
 * Handlers are hit by `fetch`/`EventSource`, not a browser navigation, so
 * redirecting to `/login` (what `requireSession()` does) makes no sense
 * here — an unauthenticated request gets a 401 JSON body instead, and it's
 * on the caller to decide what to do with that.
 *
 * Returns a discriminated result rather than throwing/redirecting so
 * route handlers stay simple:
 *
 *   const auth = await requireApiSession(request);
 *   if (!auth.session) return auth.response;
 *   const { organizationId } = auth.session; // real, never a query param
 */
export type ApiSessionResult =
  | { session: SessionData; response?: undefined }
  | { session: null; response: NextResponse };

export async function requireApiSession(request: Request): Promise<ApiSessionResult> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session };
}
