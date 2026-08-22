import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { updateContact } from "@/data/contacts";
import { logger, newCorrelationId } from "@/lib/logging/logger";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "PATCH /api/contacts/:id";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;

  const { id } = await context.params;
  logger.info("request start", { organizationId, correlationId, route, contactId: id });

  try {
    const body = await request.json();
    const contact = await updateContact(organizationId, id, {
      displayName: body.displayName,
      customFields: body.customFields,
    });
    logger.info("request end", { organizationId, correlationId, route, contactId: id, statusCode: 200 });
    return NextResponse.json({ contact });
  } catch (error) {
    logger.error("request failed", {
      organizationId,
      correlationId,
      route,
      contactId: id,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
