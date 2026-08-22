import crypto from "crypto";

/**
 * Verifies the HMAC-SHA256 signature of an inbound webhook from Meta.
 * @param rawPayload The raw string body of the request (before JSON parsing)
 * @param signatureHeader The 'x-hub-signature-256' header value
 * @param appSecret The Meta App Secret
 * @returns boolean True if the signature is valid
 */
export function verifySignature(rawPayload: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return false;
  }

  const signature = parts[1];
  const expectedHash = crypto.createHmac("sha256", appSecret).update(rawPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedHash, "hex"));
  } catch {
    // Throws if buffers are of different lengths (which means not equal)
    return false;
  }
}
