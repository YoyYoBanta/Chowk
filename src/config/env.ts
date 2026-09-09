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

  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),

  // Graph API version used for every Cloud API call
  // (src/providers/cloud-api/adapter.ts). Configurable because Meta retires
  // each version two years after its successor ships, so which version we
  // talk to is a deploy-time decision with an expiry date, not something
  // worth a code change and a release. Defaulted so a Phase A install (the
  // only kind that exists today) needs no new env var.
  //
  // Shape-validated, not membership-validated: a `vNN.N` regex catches the
  // realistic typo (a bare "26.0", a stray "/v26.0") while still allowing a
  // version newer than whatever this code knows about. Meta is the authority
  // on which versions are live, and an allowlist here would go stale and
  // start rejecting valid values.
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'META_GRAPH_API_VERSION must look like "v26.0"')
    .default("v26.0"),

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
