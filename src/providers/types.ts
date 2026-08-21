import type { Channel, MessageType } from "@prisma/client";

/**
 * The provider boundary (context.md rule 0 / architecture.md §5): this file
 * and factory.ts are the ONLY things the rest of the app imports from
 * src/providers/. No file outside src/providers/ may import a Baileys
 * symbol, reference a Baileys type, or know which provider is active — the
 * types below (built only from our own domain concepts + Prisma's generated
 * Channel/MessageType) are what makes that possible: both adapters produce
 * these same shapes regardless of transport.
 *
 * Types are modelled on Meta's semantics, not Baileys' (context.md §8.0.2)
 * — Meta Cloud API is the eventual destination, so Phase A (Baileys) is
 * built to look like Phase B from this line down.
 */

export type { MessageType };

/** Live connection state of a channel's transport session. Distinct from
 * `Channel.status` (the persisted, admin-facing field) — this is what the
 * adapter itself currently observes about its own socket/session. */
export type ConnectionState =
  | { status: "connecting" }
  | { status: "qr_pending"; qr: string }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string };

/** A reference to a piece of media, provider-agnostic. In Phase A this
 * wraps a Baileys download key; in Phase B, a Meta media id. Never the raw
 * bytes — those move through downloadMedia/uploadMedia.
 *
 * `directPath`/`url`/`mediaKey` (M6) are Phase A (Baileys) only: Baileys
 * media is end-to-end encrypted, so downloading it needs the CDN location
 * (`directPath`, falling back to `url`) AND the decryption key
 * (`mediaKey`, base64) — see src/providers/baileys/adapter.ts's
 * downloadMedia() and TODO-VERIFY.md's M6 section for exactly how these
 * were confirmed against Baileys' own source. Phase B's Meta media ids need
 * none of this (Meta handles decryption server-side before handing us
 * plaintext bytes over an authenticated HTTP GET) — these fields stay
 * undefined for a Cloud API-sourced reference. */
export interface MediaReference {
  id: string;
  mimeType: string;
  sha256?: string;
  fileLength?: number;
  filename?: string | null;
  directPath?: string;
  url?: string;
  mediaKey?: string;
}

/** A button/list reply an agent's contact tapped. */
export interface InteractivePayload {
  kind: "button_reply" | "list_reply";
  id: string;
  title: string;
}

export interface SendTextParams {
  channelId: string;
  to: string; // digits only, no '+', no '@s.whatsapp.net'
  body: string;
  /** providerMessageId of the message being replied to, if any. */
  contextProviderMessageId?: string;
}

export interface SendMediaParams {
  channelId: string;
  to: string;
  media: MediaReference;
  caption?: string;
  contextProviderMessageId?: string;
}

export interface SendTemplateParams {
  channelId: string;
  to: string;
  templateName: string;
  languageCode: string;
  variables: Record<string, string>;
}

export interface ProviderTemplate {
  name: string;
  languageCode: string;
  status: "APPROVED" | "PENDING" | "REJECTED";
  category: string;
  body: string;
}

export interface TemplateDefinition {
  name: string;
  languageCode: string;
  category: string;
  body: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; code: string; message: string };

export interface NormalizedInboundEvent {
  channelId: string;
  providerMessageId: string; // wamid in Phase B; Baileys key.id in Phase A
  from: string; // digits only, no '+', no '@s.whatsapp.net'
  contactName: string | null;
  timestamp: Date;
  type: MessageType; // map unknowns to UNSUPPORTED
  body: string | null;
  media: MediaReference | null;
  interactive: InteractivePayload | null;
  raw: unknown; // always preserve the original payload
}

export interface NormalizedStatusEvent {
  channelId: string;
  providerMessageId: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Both providers implement this exactly. No provider-specific methods, no
 * optional escape hatches, no `if (provider === 'baileys')` anywhere outside
 * src/providers/ (context.md §8.0.1). If a caller needs different behavior
 * per transport, that's a sign this interface is missing a method — fix the
 * interface, don't branch around it (architecture.md §5 rule 3).
 */
export interface WhatsAppProvider {
  readonly name: "baileys" | "cloud-api";

  connect(channel: Channel): Promise<void>;
  disconnect(channelId: string): Promise<void>;
  getConnectionState(channelId: string): Promise<ConnectionState>;

  sendText(p: SendTextParams): Promise<SendResult>;
  sendMedia(p: SendMediaParams): Promise<SendResult>;
  sendTemplate(p: SendTemplateParams): Promise<SendResult>;
  markAsRead(channelId: string, providerMessageId: string): Promise<void>;

  downloadMedia(channelId: string, ref: MediaReference): Promise<Buffer>;
  uploadMedia(channelId: string, file: Buffer, mime: string): Promise<MediaReference>;

  listTemplates(channelId: string): Promise<ProviderTemplate[]>;
  createTemplate(channelId: string, t: TemplateDefinition): Promise<ProviderTemplate>;

  // Providers push normalized events here; they never write to the DB
  // themselves — that's the ingest-inbound / status-update consumers' job.
  onInbound(handler: (e: NormalizedInboundEvent) => Promise<void>): void;
  onStatusUpdate(handler: (e: NormalizedStatusEvent) => Promise<void>): void;
}
