import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { updateContact } from "@/data/contacts";
import { listCustomFieldDefinitions } from "@/data/custom-fields";
import { validateCustomFieldValues } from "@/lib/custom-fields/validate";
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

    if (body.customFields && typeof body.customFields === "object") {
      const definitions = await listCustomFieldDefinitions(organizationId);
      const validation = validateCustomFieldValues(definitions, body.customFields);
      if (!validation.ok) {
        logger.info("request end", {
          organizationId, correlationId, route, contactId: id, statusCode: 400,
        });
        return NextResponse.json({ error: "Invalid custom field value(s)", fieldErrors: validation.errors }, { status: 400 });
      }
    }

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
