import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { listUsersInOrg, createUser, getUserByEmail } from "@/data/users";
import { hashPassword } from "@/lib/auth/password";
import type { Role } from "@prisma/client";

/**
 * GET /api/users — the org's user roster. Every authenticated agent can
 * see it (assigning a conversation to a colleague is a normal agent
 * action, not admin-only — src/app/(dashboard)/dashboard/_components/
 * contact-panel.tsx's assignee picker) — role/isActive are included too
 * since the admin Users screen reuses this same route rather than a
 * second admin-only one; the assignee picker just ignores those fields
 * and filters to active users client-side.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;

  const users = await listUsersInOrg(auth.session.organizationId);
  return NextResponse.json({
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive })),
  });
}

/**
 * POST /api/users — invite a new user (admin-only, context.md §10.6's
 * "Users (invite/role/deactivate)"). No email delivery exists in this
 * codebase yet, so a random temporary password is generated and returned
 * once in the response body for the admin to relay out-of-band — the same
 * "no email service, so do the honest local-dev equivalent" call this
 * project already made for template rejection reasons/QR pairing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  if (auth.session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role: Role = body.role === "ADMIN" ? "ADMIN" : "AGENT";

    if (!email || !name) {
      return NextResponse.json({ error: "email and name are required" }, { status: 400 });
    }
    const existing = await getUserByEmail(auth.session.organizationId, email);
    if (existing) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }

    const temporaryPassword = randomUUID().slice(0, 12);
    const user = await createUser(auth.session.organizationId, {
      email,
      name,
      role,
      passwordHash: await hashPassword(temporaryPassword),
    });

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive },
      temporaryPassword,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
