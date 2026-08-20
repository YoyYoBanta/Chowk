import type { Channel } from "@prisma/client";
import type {
  ConnectionState,
  MediaReference,
  NormalizedInboundEvent,
  NormalizedStatusEvent,
  ProviderTemplate,
  SendMediaParams,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  TemplateDefinition,
  WhatsAppProvider,
} from "../types";

/**
 * Meta WhatsApp Cloud API adapter — STUB ONLY until M10 (explicit
 * non-goal for this milestone, per the M2 task list: "No real Cloud API
 * implementation — it stays a stub until M10").
 *
 * The entire point of this file existing at M2 is architectural, not
 * functional (architecture.md §5): it must implement `WhatsAppProvider`
 * completely and be selectable via `WHATSAPP_PROVIDER=cloud-api` without
 * touching a single file outside src/providers/. If it didn't compile
 * cleanly against the interface, that would mean the interface itself was
 * shaped around Baileys instead of being transport-neutral — the fix would
 * be to the interface, not a workaround here (context.md §11, M2 note).
 *
 * Every method below is intentionally unimplemented. Per context.md rule 1
 * ("do not trust your training data for Meta Cloud API specifics... if you
 * cannot fetch [the docs], write the integration behind an interface, stub
 * it, and flag it clearly in TODO-VERIFY.md") — real field names, endpoint
 * shapes, and error codes for the Cloud API are deliberately NOT guessed
 * here. See TODO-VERIFY.md's M2 section.
 */
class CloudApiProvider implements WhatsAppProvider {
  readonly name = "cloud-api" as const;

  private readonly inboundHandlers: Array<(e: NormalizedInboundEvent) => Promise<void>> = [];
  private readonly statusHandlers: Array<(e: NormalizedStatusEvent) => Promise<void>> = [];

  async connect(_channel: Channel): Promise<void> {
    throw new Error("cloud-api: connect() not implemented until M10");
  }

  async disconnect(_channelId: string): Promise<void> {
    throw new Error("cloud-api: disconnect() not implemented until M10");
  }

  async getConnectionState(_channelId: string): Promise<ConnectionState> {
    return { status: "disconnected", reason: "cloud-api provider is a stub until M10" };
  }

  async sendText(_p: SendTextParams): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      code: "NOT_IMPLEMENTED",
      message: "cloud-api: sendText() not implemented until M10",
    };
  }

  async sendMedia(_p: SendMediaParams): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      code: "NOT_IMPLEMENTED",
      message: "cloud-api: sendMedia() not implemented until M10",
    };
  }

  async sendTemplate(_p: SendTemplateParams): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      code: "NOT_IMPLEMENTED",
      message: "cloud-api: sendTemplate() not implemented until M10",
    };
  }

  async markAsRead(_channelId: string, _providerMessageId: string): Promise<void> {
    throw new Error("cloud-api: markAsRead() not implemented until M10");
  }

  async downloadMedia(_channelId: string, _ref: MediaReference): Promise<Buffer> {
    throw new Error("cloud-api: downloadMedia() not implemented until M10");
  }

  async uploadMedia(_channelId: string, _file: Buffer, _mime: string): Promise<MediaReference> {
    throw new Error("cloud-api: uploadMedia() not implemented until M10");
  }

  async listTemplates(_channelId: string): Promise<ProviderTemplate[]> {
    return [];
  }

  async createTemplate(_channelId: string, _t: TemplateDefinition): Promise<ProviderTemplate> {
    throw new Error("cloud-api: createTemplate() not implemented until M10");
  }

  onInbound(handler: (e: NormalizedInboundEvent) => Promise<void>): void {
    this.inboundHandlers.push(handler);
  }

  onStatusUpdate(handler: (e: NormalizedStatusEvent) => Promise<void>): void {
    this.statusHandlers.push(handler);
  }
}

export const cloudApiAdapter: WhatsAppProvider = new CloudApiProvider();
