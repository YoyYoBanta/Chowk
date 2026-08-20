import { z } from "zod";

/**
 * Validates process.env at import time. Throws immediately on invalid or
 * missing values so misconfiguration fails fast at boot rather than at the
 * first request that touches the missing value.
 *
 * No silent defaults for anything security- or connectivity-critical.
 */
const envSchema = z.object({
  WHATSAPP_PROVIDER: z.enum(["baileys", "cloud-api"]),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  SESSION_SECRET: z.string().min(32),

  OBJECT_STORAGE_ENDPOINT: z.string().url(),
  OBJECT_STORAGE_BUCKET: z.string().min(1),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1),
  // MinIO mostly ignores region, but the S3 SDK requires one to be set.
  OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
  // MinIO requires path-style addressing (unlike AWS S3 proper), so this
  // defaults to true rather than the AWS SDK's own default of false.
  OBJECT_STORAGE_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : value === "true")),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables:\n${JSON.stringify(z.treeifyError(parsed.error), null, 2)}`,
  );
}

export const env = parsed.data;
export type Env = typeof env;
