import { randomUUID } from "node:crypto";

/**
 * Structured JSON logger (architecture.md §16, pulled forward from its
 * originally-planned M9 slot per the maintainer's explicit request this
 * milestone). Deliberately boring: `console.log(JSON.stringify(...))` with
 * a typed wrapper, no logging framework dependency.
 *
 * Two things this exists to make easy:
 *
 * 1. **Correlation.** `newCorrelationId()` wraps `node:crypto`'s
 *    `randomUUID()` — no new dependency. Generate one id per inbound
 *    event / per HTTP request / per SSE connection, thread it through
 *    every log call touching that unit of work, and a single message's
 *    journey (queue → consumer → DB write → realtime publish) becomes
 *    traceable by grepping one id across stdout.
 *
 * 2. **Never leaking message content into logs** (context.md §12: "Message
 *    content is sensitive customer data. No message bodies in application
 *    logs."). `LogFields` below is a closed interface, not a free-form
 *    `Record<string, unknown>` — there is no `body`/`content`/`text`
 *    property on it, so passing `{ body: message.body }` as a field is a
 *    TypeScript excess-property-check error at the call site (see
 *    logger.test.ts for a `@ts-expect-error` proving this). This can't
 *    stop someone from smuggling a body through a variable typed `any`,
 *    but it makes the *normal* accidental case — spreading a Message row
 *    into the fields object — fail to compile.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Deliberately closed (no index signature). Add a new named field here
 * when a real call site needs one — never widen this to
 * `Record<string, unknown>`, and never add `body`/`content`/`text`/
 * `caption`/`media` fields for message content.
 */
export interface LogFields {
  organizationId?: string;
  correlationId?: string;
  userId?: string;
  channelId?: string;
  conversationId?: string;
  contactId?: string;
  messageId?: string;
  providerMessageId?: string;
  provider?: string;
  messageType?: string;
  status?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  reason?: string;
  count?: number;
  // M6 additions — metadata about a media attachment (id/MIME type/byte
  // size, and whether an inbound event carried one at all). Still no
  // `body`/`content`/`text`/`caption`/`media` field — these are metadata
  // about a file, never its content.
  mediaId?: string;
  mimeType?: string;
  sizeBytes?: number;
  hasMedia?: boolean;
  // M7 addition — a template's name (an identifier, like messageType or
  // errorCode above), never its rendered/substituted body.
  templateName?: string;
}

interface LogLine extends LogFields {
  level: LogLevel;
  message: string;
  timestamp: string;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line: LogLine = {
    level,
    message,
    ...fields,
    timestamp: new Date().toISOString(),
  };
  const serialized = JSON.stringify(line);
  if (level === "error" || level === "warn") console.error(serialized);
  else console.log(serialized);
}

export const logger = {
  debug: (message: string, fields?: LogFields): void => emit("debug", message, fields),
  info: (message: string, fields?: LogFields): void => emit("info", message, fields),
  warn: (message: string, fields?: LogFields): void => emit("warn", message, fields),
  error: (message: string, fields?: LogFields): void => emit("error", message, fields),
};

/** One correlation id per inbound event / HTTP request / SSE connection. */
export function newCorrelationId(): string {
  return randomUUID();
}
