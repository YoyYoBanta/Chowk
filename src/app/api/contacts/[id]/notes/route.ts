import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { createNote, listNotesByContact } from "@/data/notes";
import { listUsersInOrg, getUserById } from "@/data/users";

/**
 * `Note.authorUserId` is a plain scalar, not an enforced FK (same "stay a
 * plain scalar" precedent as `Conversation.assignedUserId` — see
 * prisma/schema.prisma's own comment on that field) — so the author's name
 * is resolved here, in the route, by matching against the org's user list,
 * rather than a Prisma `include`. context.md §10.5 calls for "notes with
 * author+timestamp" in the contact panel; this is what makes the author
 * half of that possible without a schema change.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;

  const { id } = await context.params;
  try {
    const [notes, users] = await Promise.all([
      listNotesByContact(auth.session.organizationId, id),
      listUsersInOrg(auth.session.organizationId),
    ]);
    const nameByUserId = new Map(users.map((u) => [u.id, u.name]));
    const notesWithAuthor = notes.map((note) => ({
      ...note,
      authorName: nameByUserId.get(note.authorUserId) ?? "Unknown",
    }));
    return NextResponse.json({ notes: notesWithAuthor });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;

  const { id } = await context.params;
  try {
    const body = await request.json();
    const note = await createNote(auth.session.organizationId, id, auth.session.userId, body.body);
    const author = await getUserById(auth.session.organizationId, auth.session.userId);
    return NextResponse.json({ note: { ...note, authorName: author?.name ?? "Unknown" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
