/**
 * Maps Meta Cloud API error codes to our standard retryable/terminal buckets.
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export interface MappedError {
  retryable: boolean;
  code: string;
  message: string;
}

interface MaybeGraphError {
  response?: { data?: { error?: { code?: string | number; message?: string } } };
  code?: string | number;
  message?: string;
}

export function mapMetaError(error: unknown): MappedError {
  // If it's not a standard graph error object, return a generic failure
  const err = error as MaybeGraphError;
  const code = err?.response?.data?.error?.code ?? err?.code ?? "UNKNOWN";
  const rawMessage = err?.response?.data?.error?.message ?? err?.message ?? "Unknown error";

  // 1. Rate limits & transient errors (Retryable)
  // 4: Application-level rate limit
  // 130429: Rate limit hit
  // 80007: Rate limit issue
  if (code === 4 || code === 80007 || code === 130429 || code === "ECONNRESET" || code === "ETIMEDOUT") {
    return {
      retryable: true,
      code: "RATE_LIMIT_OR_TRANSIENT",
      message: `Transient error or rate limit hit (Meta code: ${code}). Retrying...`,
    };
  }

  // 2. Auth errors (Terminal)
  // 190: Invalid OAuth 2.0 Access Token
  if (code === 190) {
    return {
      retryable: false,
      code: "AUTH_FAILED",
      message: "The Meta access token is invalid or expired. Re-authenticate the channel.",
    };
  }

  // 3. 24-hour window / Message format issues (Terminal)
  // 131047: 24-hour window closed
  if (code === 131047) {
    return {
      retryable: false,
      code: "WINDOW_CLOSED",
      message: "The 24-hour reply window has closed. You must send a template.",
    };
  }

  // 4. Invalid recipient (Terminal)
  // 131026: Receiver is incapable of receiving this message
  if (code === 131026) {
    return {
      retryable: false,
      code: "INVALID_RECIPIENT",
      message: "The contact cannot receive WhatsApp messages (number may be invalid or not on WhatsApp).",
    };
  }

  // Default terminal catch-all
  return {
    retryable: false,
    code: `META_ERROR_${code}`,
    message: rawMessage,
  };
}
