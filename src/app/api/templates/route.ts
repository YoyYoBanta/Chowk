import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/guard";
import { getWhatsAppProvider } from "@/providers/factory";
import { createTemplate, listTemplates } from "@/data/templates";
import { logger, newCorrelationId } from "@/lib/logging/logger";
import { listChannelsInOrg } from "@/data/channels";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "GET /api/templates";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId");

  logger.info("request start", { organizationId, correlationId, route });

  if (!channelId) {
    return NextResponse.json({ error: "channelId is required" }, { status: 400 });
  }

  try {
    const templates = await listTemplates(organizationId, channelId);
    return NextResponse.json({ templates });
  } catch (error) {
    logger.error("request failed", {
      organizationId,
      correlationId,
      route,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const createTemplateSchema = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1),
  languageCode: z.string().min(1),
  category: z.string().min(1),
  body: z.string().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "POST /api/templates";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;

  logger.info("request start", { organizationId, correlationId, route });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTemplateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    // Verify channel belongs to org
    const channels = await listChannelsInOrg(organizationId);
    if (!channels.find((c) => c.id === parsed.data.channelId)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const created = await getWhatsAppProvider().createTemplate(parsed.data.channelId, {
      name: parsed.data.name,
      languageCode: parsed.data.languageCode,
      category: parsed.data.category,
      body: parsed.data.body,
    });

    // Persist locally too (architecture.md §9's create-template sequence:
    // "API->>DB: insert Template row, status = PENDING") — without this,
    // a newly created template never shows up in our own listTemplates()
    // (and so never appears in the composer's template picker) until the
    // next sync cycle happens to catch it. `ProviderTemplate` only exposes
    // a flat `body`, not the full Meta component structure our schema's
    // `components: Json` column is meant to hold (context.md §7.5: "full
    // component structure as Meta returns it") — an honest, minimal
    // mapping is used here rather than inventing structure the interface
    // doesn't give us.
    const saved = await createTemplate(organizationId, parsed.data.channelId, {
      name: created.name,
      language: created.languageCode,
      category: created.category,
      status: created.status,
      components: { body: created.body },
    });

    return NextResponse.json({ template: saved });
  } catch (error) {
    logger.error("request failed", {
      organizationId,
      correlationId,
      route,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
