import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { addTagToContact } from "@/data/tags";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  
  const { id } = await context.params;
  try {
    const body = await request.json();
    await addTagToContact(auth.session.organizationId, id, body.tagId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
