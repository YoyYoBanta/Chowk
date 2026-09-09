/**
 * Maps Meta Cloud API error codes to our standard retryable/terminal buckets.
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 *
 * Every code below was confirmed against the live error-codes page on
 * 2026-09-09 (see TODO-VERIFY.md's M7/M8/M10 section) — not carried over
 * from training data, which context.md rule 1 specifically forbids trusting
 * for this API.
 *
 * ## The shape this has to accept
 *
 * `CloudApiProvider.callMetaAPI()` does `throw data` with the *parsed Graph
 * response body*, which is `{ error: { code, message, type, error_subcode,
 * fbtrace_id } }`. The original implementation only looked at
 * `err.response.data.error.code` (an axios-client shape) and `err.code`, and
 * the adapter uses `fetch`, not axios — so neither branch ever matched, every
 * Graph error fell through to the `UNKNOWN` catch-all, and every one of them
 * was classified **terminal**. Rate limits and throughput errors, which are
 * the whole reason a retryable bucket exists, were being failed permanently
 * on the first attempt.
 *
 * All three shapes are therefore accepted now:
 *   1. `{ error: { code } }`         - what callMetaAPI actually throws
 *   2. `{ response: { data: { error: { code } } } }` - axios, if a caller ever swaps
 *   3. `{ code }`                    - Node system errors (ECONNRESET, ...)
 */

export interface MappedError {
  retryable: boolean;
  code: string;
  message: string;
}

interface GraphErrorBody {
  error?: { code?: string | number; message?: string };
}

interface MaybeGraphError extends GraphErrorBody {
  response?: { data?: GraphErrorBody };
  code?: string | number;
  message?: string;
}

/**
 * Retryable Meta codes. Everything here is transient: the identical request
 * is expected to succeed later, so the send stays queued rather than being
 * surfaced to the agent as a permanent failure.
 */
const RETRYABLE_META_CODES = new Set<number>([
  4, // Application-level API call rate limit reached.
  80007, // The WhatsApp Business Account has reached its rate limit.
  130429, // Cloud API message throughput has been reached.
  131056, // Too many messages sent to the same recipient in a short period
  // (pair rate limit). Confirmed retryable on 2026-09-09 - it was previously
  // hitting the terminal catch-all, permanently failing sends that would
  // have succeeded on a later attempt.
]);

/** Node/undici transport failures, thrown before any Graph body exists. */
const RETRYABLE_TRANSPORT_CODES = new Set<string>([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function extractCode(err: MaybeGraphError): string | number {
  return (
    err?.error?.code ?? err?.response?.data?.error?.code ?? err?.code ?? "UNKNOWN"
  );
}

function extractMessage(err: MaybeGraphError): string {
  return (
    err?.error?.message ??
    err?.response?.data?.error?.message ??
    err?.message ??
    "Unknown error"
  );
}

export function mapMetaError(error: unknown): MappedError {
  const err = (error ?? {}) as MaybeGraphError;
  const code = extractCode(err);
  const rawMessage = extractMessage(err);

  // 1. Rate limits & transient transport errors (retryable).
  if (
    (typeof code === "number" && RETRYABLE_META_CODES.has(code)) ||
    (typeof code === "string" && RETRYABLE_TRANSPORT_CODES.has(code))
  ) {
    return {
      retryable: true,
      code: "RATE_LIMIT_OR_TRANSIENT",
      message: `Transient error or rate limit hit (Meta code: ${code}). Retrying...`,
    };
  }

  // 2. Auth errors (terminal). 190: access token invalid or expired.
  if (code === 190) {
    return {
      retryable: false,
      code: "AUTH_FAILED",
      message: "The Meta access token is invalid or expired. Re-authenticate the channel.",
    };
  }

  // 3. 133010: the phone number isn't registered on the WhatsApp Business
  // Platform. A configuration problem, not a transient one - retrying sends
  // the same doomed request, so it fails fast and visibly instead.
  if (code === 133010) {
    return {
      retryable: false,
      code: "NUMBER_NOT_REGISTERED",
      message: "This phone number is not registered on the WhatsApp Business Platform.",
    };
  }

  // 4. 131047: the 24-hour customer service window has closed.
  if (code === 131047) {
    return {
      retryable: false,
      code: "WINDOW_CLOSED",
      message: "The 24-hour reply window has closed. You must send a template.",
    };
  }

  // 5. 131026: the recipient cannot receive this message (not on WhatsApp,
  // hasn't accepted terms, or is on too old an app version).
  if (code === 131026) {
    return {
      retryable: false,
      code: "INVALID_RECIPIENT",
      message: "The contact cannot receive WhatsApp messages (number may be invalid or not on WhatsApp).",
    };
  }

  // 6. 131051: unsupported message type.
  if (code === 131051) {
    return {
      retryable: false,
      code: "UNSUPPORTED_MESSAGE_TYPE",
      message: "Meta rejected this message type as unsupported.",
    };
  }

  // Default catch-all: terminal. Deliberately conservative - an unrecognized
  // code is surfaced to the agent rather than retried forever against an
  // error we don't understand. Any code found to be genuinely transient
  // belongs in RETRYABLE_META_CODES above, with a doc reference.
  return {
    retryable: false,
    code: `META_ERROR_${code}`,
    message: rawMessage,
  };
}
