import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { listQuickReplies, createQuickReply } from "@/data/quick-replies";

export async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  
  try {
    const quickReplies = await listQuickReplies(auth.session.organizationId);
    return NextResponse.json({ quickReplies });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  
  try {
    const body = await request.json();
    const quickReply = await createQuickReply(
      auth.session.organizationId,
      body.shortcut,
      body.body,
      body.mediaId
    );
    return NextResponse.json({ quickReply });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
