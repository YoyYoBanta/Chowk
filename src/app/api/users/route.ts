import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { listUsersInOrg } from "@/data/users";

/**
 * GET /api/users — the org's user roster, for the assignee picker
 * (conversation "Mine"/"Unassigned" filters already existed; there was no
 * way to actually assign a conversation to someone from the UI). Every
 * authenticated agent can see the roster — assigning conversations is a
 * normal agent action, not admin-only, unlike /api/channels.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;

  const users = await listUsersInOrg(auth.session.organizationId);
  return NextResponse.json({
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email })),
  });
}
