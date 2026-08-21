import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/auth/guard";
import { getMediaById } from "@/data/media";
import { getObjectStream } from "@/lib/storage/object-store";
import { logger, newCorrelationId } from "@/lib/logging/logger";

/**
 * GET /api/media/:id — serves one stored media object's bytes (M6). Not
 * part of context.md §9's literal route list (that section predates the
 * object-storage design, resolved at Pre-M1/M6 — see TODO-VERIFY.md) but
 * necessary for it to mean anything: the thread UI's <img>/<video>/
 * <audio>/document-download elements (src/app/(dashboard)/dashboard/
 * _components/message-bubble.tsx) need SOME authenticated URL to point at,
 * and the object store (MinIO) is never assumed to be reachable directly
 * from the browser — this route is that URL
 * (src/lib/media/summary.ts's mediaToSummary is the only place that builds
 * one: always `/api/media/<mediaId>`).
 *
 * Same requireApiSession + organizationId-scoped lookup pattern as every
 * other route (architecture.md §12) — a media id belonging to another
 * organization 404s here exactly like a cross-org conversation id would,
 * never leaking whether the id exists at all in some other org.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const correlationId = newCorrelationId();
  const route = "GET /api/media/:id";

  const auth = await requireApiSession(request);
  if (!auth.session) return auth.response;
  const { organizationId } = auth.session;
  const { id: mediaId } = await context.params;

  const media = await getMediaById(organizationId, mediaId);
  if (!media) {
    logger.info("request end", { organizationId, correlationId, route, mediaId, statusCode: 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { body, contentType, contentLength } = await getObjectStream(media.storageKey);

    const headers = new Headers();
    headers.set("Content-Type", contentType ?? media.mimeType);
    if (contentLength != null) headers.set("Content-Length", String(contentLength));
    if (media.fileName) {
      // Strip characters that would let a filename break out of the
      // quoted Content-Disposition parameter (header injection).
      const safeName = media.fileName.replace(/["\r\n]/g, "");
      headers.set("Content-Disposition", `inline; filename="${safeName}"`);
    }
    // Every storage key is minted fresh (randomUUID()) and never reused for
    // different content (src/services/media/upload-outbound.ts /
    // download-and-store.ts) — safe to cache aggressively.
    headers.set("Cache-Control", "private, max-age=31536000, immutable");

    logger.info("request end", { organizationId, correlationId, route, mediaId, statusCode: 200 });
    return new NextResponse(body, { status: 200, headers });
  } catch (error) {
    logger.error("request failed", {
      organizationId,
      correlationId,
      route,
      mediaId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
