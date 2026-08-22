import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { listCustomFieldDefinitions, createCustomFieldDefinition } from "@/data/custom-fields";
import type { FieldType } from "@prisma/client";

export async function GET(
  request: NextRequest,
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;

  try {
    const definitions = await listCustomFieldDefinitions(auth.session.organizationId);
    return NextResponse.json({ definitions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

const VALID_FIELD_TYPES: FieldType[] = ["TEXT", "NUMBER", "DATE", "LIST"];

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;

  try {
    const body = await request.json();
    if (typeof body.key !== "string" || !body.key.trim() || typeof body.label !== "string" || !body.label.trim()) {
      return NextResponse.json({ error: "key and label are required" }, { status: 400 });
    }
    if (!VALID_FIELD_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of ${VALID_FIELD_TYPES.join(", ")}` }, { status: 400 });
    }
    const definition = await createCustomFieldDefinition(
      auth.session.organizationId,
      body.key,
      body.label,
      body.type,
      body.options,
    );
    return NextResponse.json({ definition });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
