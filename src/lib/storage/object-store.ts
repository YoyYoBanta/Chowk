import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/config/env";

/**
 * Thin S3-compatible object storage client (architecture.md §4/§14 — "S3"/
 * "Object storage" in the repo layout and deployment diagrams; context.md
 * §8.3's "our own object storage"). Works against MinIO locally
 * (OBJECT_STORAGE_* in .env.example / src/config/env.ts — the object
 * storage provider decision context.md §14 item 3 flagged as needed "by M6
 * at the latest" was resolved at Pre-M1: MinIO/S3-compatible, `@aws-sdk/
 * client-s3` already in package.json) and any real S3-compatible provider
 * in production without changing this file.
 *
 * Lazily constructed on first use, same reasoning as
 * src/queue/connection.ts / src/services/realtime/publish.ts's publisher:
 * this module is reachable from the fast Vitest suite's module graph
 * (transitively, via src/services/media/*.ts), which must do zero network
 * I/O on a bare import. The `S3Client` constructor itself does no I/O
 * either way — only `.send()` does — but the lazy-getter pattern is kept
 * for consistency with every other shared-client module in this codebase.
 */
let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: env.OBJECT_STORAGE_ENDPOINT,
      region: env.OBJECT_STORAGE_REGION,
      forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY,
        secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY,
      },
    });
  }
  return client;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: env.OBJECT_STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Buffers the full object into memory — used where the caller needs the raw
 * bytes to hand to another API (e.g. `provider.uploadMedia()`, which itself
 * takes a `Buffer`). `Body.transformToByteArray()` is the AWS SDK v3
 * `SdkStreamMixin` helper for this (confirmed against `@smithy/types`'
 * own `serde.d.ts` — context.md rule 2, never guess a third-party API
 * shape — see TODO-VERIFY.md's M6 section), not a hand-rolled stream
 * collector.
 */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: env.OBJECT_STORAGE_BUCKET, Key: key }),
  );
  if (!result.Body) {
    throw new Error(`object-store: no body returned for key "${key}"`);
  }
  const bytes = await result.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export interface ObjectStream {
  body: ReadableStream;
  contentType: string | undefined;
  contentLength: number | undefined;
}

/**
 * Streams the object without buffering the whole thing into memory first —
 * used by `GET /api/media/:id` (src/app/api/media/[id]/route.ts) to serve
 * media straight through to the browser. `Body.transformToWebStream()`
 * returns a web-standard `ReadableStream`, which `NextResponse`/`Response`
 * accept directly as a body.
 */
export async function getObjectStream(key: string): Promise<ObjectStream> {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: env.OBJECT_STORAGE_BUCKET, Key: key }),
  );
  if (!result.Body) {
    throw new Error(`object-store: no body returned for key "${key}"`);
  }
  return {
    body: result.Body.transformToWebStream(),
    contentType: result.ContentType,
    contentLength: result.ContentLength,
  };
}
