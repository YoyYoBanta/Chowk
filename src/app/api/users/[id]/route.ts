import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { updateUser } from "@/data/users";
import type { Role } from "@prisma/client";

/**
 * PATCH /api/users/:id — change role and/or active status (admin-only).
 * An admin can't deactivate or demote their own account through this route
 * — a common safety rule (an org should never lock its last admin out of
 * its own admin screen), enforced here rather than in the data layer since
 * it's a request-context decision (who's asking), not a tenancy concern.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  if (auth.session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (id === auth.session.userId) {
    return NextResponse.json({ error: "You can't change your own role or deactivate yourself" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const data: { role?: Role; isActive?: boolean } = {};
    if (body.role === "ADMIN" || body.role === "AGENT") data.role = body.role;
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;

    await updateUser(auth.session.organizationId, id, data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
