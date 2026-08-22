import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { removeTagFromContact } from "@/data/tags";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string, tagId: string }> },
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  
  const { id, tagId } = await context.params;
  try {
    await removeTagFromContact(auth.session.organizationId, id, tagId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
