import { cookies } from "next/headers";
import { getIronSession, type IronSession } from "iron-session";
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

const SESSION_COOKIE_NAME = "chowk_session";

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
