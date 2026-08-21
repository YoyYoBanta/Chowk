import { cookies } from "next/headers";
import { getIronSession, sealData, type IronSession } from "iron-session";
import { env } from "@/config/env";
import type { Role } from "@prisma/client";

/**
 * Session-based auth via iron-session: the session payload is encrypted
 * and signed (AES-GCM + HMAC, via the `iron` seal format) into a single
 * cookie — no server-side session store to run/scale for M1, and no
 * hand-rolled crypto. This is the library's entire job and it's widely used
 * for exactly this (Next.js App Router session cookies).
 *
 * Payload carries just enough to enforce tenancy and role gates downstream
 * — organizationId is the only source of truth for "which tenant", per
 * architecture.md §12. Never trust an organizationId from anywhere else.
 */
export interface SessionData {
  userId: string;
  organizationId: string;
  role: Role;
}

type SessionCookie = Partial<SessionData>;

// Exported (M3) so integration tests can build a real `Cookie` header
// against a real HTTP request/route handler without duplicating this
// string — see `sealSessionCookie` below.
export const SESSION_COOKIE_NAME = "chowk_session";

const sessionOptions = {
  cookieName: SESSION_COOKIE_NAME,
  password: env.SESSION_SECRET,
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  },
};

async function getSession(): Promise<IronSession<SessionCookie>> {
  const cookieStore = await cookies();
  return getIronSession<SessionCookie>(cookieStore, sessionOptions);
}

export async function createSession(data: SessionData): Promise<void> {
  const session = await getSession();
  session.userId = data.userId;
  session.organizationId = data.organizationId;
  session.role = data.role;
  await session.save();
}

export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

export async function getCurrentSession(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session.userId || !session.organizationId || !session.role) {
    return null;
  }
  return {
    userId: session.userId,
    organizationId: session.organizationId,
    role: session.role,
  };
}

/**
 * M3 addition: reads the session from a raw `Request` (a Route Handler's
 * `NextRequest`) rather than from `next/headers`' `cookies()`.
 *
 * Why a second read path instead of reusing `getCurrentSession()`:
 * `next/headers`' `cookies()` only works inside the AsyncLocalStorage
 * context Next's own server sets up around a real request — fine for the
 * `(dashboard)` Server Components/layout, which only ever run there, but
 * it means a route handler built on it could never be unit-tested by
 * importing and calling the exported `GET` function directly (no such
 * context exists outside `next dev`/`next start`). iron-session's
 * `getIronSession(request, response, options)` overload (see
 * node_modules/iron-session/dist/index.d.ts) reads straight off the
 * `Request`'s `Cookie` header instead — no framework-internal context
 * required, works identically whether Next's server invokes the handler
 * for real or a test does. The throwaway `Response` is never used here
 * (nothing calls `.save()` on a read-only GET); it's only required by
 * iron-session's signature.
 */
export async function getSessionFromRequest(request: Request): Promise<SessionData | null> {
  const session = await getIronSession<SessionCookie>(request, new Response(), sessionOptions);
  if (!session.userId || !session.organizationId || !session.role) {
    return null;
  }
  return {
    userId: session.userId,
    organizationId: session.organizationId,
    role: session.role,
  };
}

/**
 * M3 addition, test-support: seals a `SessionData` payload the exact same
 * way `createSession()` does, but returns the raw cookie VALUE instead of
 * writing it to a cookie store — for integration tests that need a real,
 * validly-sealed session cookie to attach to a real HTTP request (e.g. an
 * SSE connection to `/api/events`, or a direct route-handler call) without
 * driving the actual login form. Never used by application code paths;
 * only by tests, which build the `Cookie` header themselves as
 * `${SESSION_COOKIE_NAME}=${await sealSessionCookie(...)}`.
 */
export async function sealSessionCookie(data: SessionData): Promise<string> {
  return sealData(data, { password: env.SESSION_SECRET });
}
