import crypto from "crypto";
import type { Channel } from "@prisma/client";
import { mapMetaError } from "./error-map";
import { env } from "@/config/env";
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

const GRAPH_API_VERSION = "v20.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * `ProviderTemplate.status` (context.md §8.0.1) is a narrow 3-value union,
 * but Meta's real template statuses include more values than that
 * (PAUSED, DISABLED, IN_APPEAL, PENDING_DELETION, ...) — context.md §4.2:
 * "Statuses include APPROVED, PENDING, and paused/disabled states." Our own
 * `Template.status` column stores the raw string regardless (context.md
 * §7.5: "not enumed, since Meta adds values"); this mapping is only for the
 * narrower `ProviderTemplate` shape the rest of the app reads, and defaults
 * an unrecognized status to PENDING (never silently APPROVED) rather than
 * guessing. NOT yet verified against live Meta docs — flagged in
 * TODO-VERIFY.md, since this file is still pre-M10 (the milestone that
 * actually requires that verification pass, context.md rule 1).
 */
function normalizeMetaTemplateStatus(status: string | undefined): ProviderTemplate["status"] {
  return status === "APPROVED" || status === "PENDING" || status === "REJECTED" ? status : "PENDING";
}

class CloudApiProvider implements WhatsAppProvider {
  readonly name = "cloud-api" as const;

  private readonly channels = new Map<string, Channel>();
  private readonly inboundHandlers: Array<(e: NormalizedInboundEvent) => Promise<void>> = [];
  private readonly statusHandlers: Array<(e: NormalizedStatusEvent) => Promise<void>> = [];

  // M6: Similar to Baileys, we need a short-lived cache to pass media between uploadMedia and sendMedia
  private readonly outboundMediaCache = new Map<string, { id: string; mimeType: string }>();

  async connect(channel: Channel): Promise<void> {
    this.channels.set(channel.id, channel);
    // Cloud API doesn't need to hold a persistent socket, it's just webhook based.
  }

  async disconnect(channelId: string): Promise<void> {
    this.channels.delete(channelId);
  }

  async getConnectionState(channelId: string): Promise<ConnectionState> {
    const channel = this.channels.get(channelId);
    if (!channel) return { status: "disconnected", reason: "Not connected locally." };
    if (!channel.metaPhoneNumberId) return { status: "disconnected", reason: "Missing metaPhoneNumberId." };
    return { status: "connected" };
  }

  private getAccessToken(_channel?: Channel): string {
    // For Tier 1, use the global ENV token.
    if (!env.META_ACCESS_TOKEN) {
      throw new Error("META_ACCESS_TOKEN is not configured.");
    }
    return env.META_ACCESS_TOKEN;
  }

  private async callMetaAPI(path: string, method: string, token: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${GRAPH_API_BASE}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();
    if (!res.ok) {
      throw data; // Catch this in the callers and pass to mapMetaError
    }
    return data;
  }

  async sendText(p: SendTextParams): Promise<SendResult> {
    const channel = this.channels.get(p.channelId);
    if (!channel?.metaPhoneNumberId) {
      return { ok: false, retryable: true, code: "NOT_CONFIGURED", message: "Channel missing meta phone ID." };
    }

    try {
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: p.to,
        type: "text",
        text: { body: p.body },
      };

      const result = await this.callMetaAPI(`/${channel.metaPhoneNumberId}/messages`, "POST", this.getAccessToken(channel), payload) as { messages?: Array<{ id: string }> };
      
      const providerMessageId = result.messages?.[0]?.id;
      if (!providerMessageId) throw new Error("No message ID returned from Meta");
      
      return { ok: true, providerMessageId };
    } catch (error: unknown) {
      const mapped = mapMetaError(error);
      return { ok: false, retryable: mapped.retryable, code: mapped.code, message: mapped.message };
    }
  }

  async sendMedia(p: SendMediaParams): Promise<SendResult> {
    const channel = this.channels.get(p.channelId);
    if (!channel?.metaPhoneNumberId) {
      return { ok: false, retryable: true, code: "NOT_CONFIGURED", message: "Channel missing meta phone ID." };
    }

    const cached = this.outboundMediaCache.get(p.media.id);
    if (!cached) {
      return { ok: false, retryable: false, code: "MEDIA_NOT_FOUND", message: "Media ID not found in upload cache." };
    }

    let mediaType = "document";
    if (cached.mimeType.startsWith("image/")) mediaType = "image";
    else if (cached.mimeType.startsWith("video/")) mediaType = "video";
    else if (cached.mimeType.startsWith("audio/")) mediaType = "audio";

    try {
      const payload: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: p.to,
        type: mediaType,
      };

      const mediaPayload: Record<string, unknown> = { id: cached.id };
      if (p.caption && mediaType !== "audio") {
        mediaPayload.caption = p.caption;
      }
      if (mediaType === "document" && p.media.filename) {
        mediaPayload.filename = p.media.filename;
      }

      payload[mediaType] = mediaPayload;

      const result = await this.callMetaAPI(`/${channel.metaPhoneNumberId}/messages`, "POST", this.getAccessToken(channel), payload) as { messages?: Array<{ id: string }> };
      
      const providerMessageId = result.messages?.[0]?.id;
      if (!providerMessageId) throw new Error("No message ID returned from Meta");

      this.outboundMediaCache.delete(p.media.id);
      
      return { ok: true, providerMessageId };
    } catch (error: unknown) {
      const mapped = mapMetaError(error);
      return { ok: false, retryable: mapped.retryable, code: mapped.code, message: mapped.message };
    }
  }

  async sendTemplate(p: SendTemplateParams): Promise<SendResult> {
    const channel = this.channels.get(p.channelId);
    if (!channel?.metaPhoneNumberId) {
      return { ok: false, retryable: true, code: "NOT_CONFIGURED", message: "Channel missing meta phone ID." };
    }

    try {
      // Build parameters array from p.variables
      const parameters = [];
      const keys = Object.keys(p.variables).sort((a, b) => parseInt(a) - parseInt(b));
      for (const key of keys) {
        parameters.push({
          type: "text",
          text: p.variables[key],
        });
      }

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: p.to,
        type: "template",
        template: {
          name: p.templateName,
          language: { code: p.languageCode },
          components: parameters.length > 0 ? [
            {
              type: "body",
              parameters,
            }
          ] : [],
        },
      };

      const result = await this.callMetaAPI(`/${channel.metaPhoneNumberId}/messages`, "POST", this.getAccessToken(channel), payload) as { messages?: Array<{ id: string }> };
      
      const providerMessageId = result.messages?.[0]?.id;
      if (!providerMessageId) throw new Error("No message ID returned from Meta");
      
      return { ok: true, providerMessageId };
    } catch (error: unknown) {
      const mapped = mapMetaError(error);
      return { ok: false, retryable: mapped.retryable, code: mapped.code, message: mapped.message };
    }
  }

  async markAsRead(channelId: string, providerMessageId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel?.metaPhoneNumberId) return;

    try {
      const payload = {
        messaging_product: "whatsapp",
        status: "read",
        message_id: providerMessageId,
      };

      await this.callMetaAPI(`/${channel.metaPhoneNumberId}/messages`, "POST", this.getAccessToken(channel), payload);
    } catch {
      // Best-effort
    }
  }

  async downloadMedia(channelId: string, ref: MediaReference): Promise<Buffer> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error("Channel not found");

    const token = this.getAccessToken(channel);

    // 1. Fetch URL from Media ID
    const metaMediaId = ref.id;
    const info = await this.callMetaAPI(`/${metaMediaId}`, "GET", token) as { url?: string };
    if (!info.url) throw new Error("No URL returned for media ID");

    // 2. Fetch binary data
    const res = await fetch(info.url, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) throw new Error(`Failed to download media bytes: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async uploadMedia(channelId: string, file: Buffer, mime: string): Promise<MediaReference> {
    const channel = this.channels.get(channelId);
    if (!channel?.metaPhoneNumberId) throw new Error("Channel missing meta phone ID.");

    // Cloud API requires multipart/form-data for media upload
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    // `Buffer`'s `.buffer` is typed `ArrayBufferLike` (could be a
    // SharedArrayBuffer), which `BlobPart` doesn't accept — `Uint8Array.from`
    // copies into a plain, real `ArrayBuffer`-backed view instead.
    const blob = new Blob([Uint8Array.from(file)], { type: mime });
    formData.append("file", blob, "upload");

    const res = await fetch(`${GRAPH_API_BASE}/${channel.metaPhoneNumberId}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.getAccessToken(channel)}`,
      },
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Upload failed: ${JSON.stringify(data)}`);
    }

    const internalId = crypto.randomUUID();
    this.outboundMediaCache.set(internalId, { id: data.id, mimeType: mime });
    
    return { id: internalId, mimeType: mime, fileLength: file.length };
  }

  async listTemplates(channelId: string): Promise<ProviderTemplate[]> {
    const channel = this.channels.get(channelId);
    if (!channel?.metaWabaId) return []; // Needs WABA ID

    interface MetaTemplateComponent { type: string; text?: string }
    interface MetaTemplate {
      name: string;
      language: string;
      status: string;
      category: string;
      components?: MetaTemplateComponent[];
    }
    const data = await this.callMetaAPI(
      `/${channel.metaWabaId}/message_templates?limit=100`,
      "GET",
      this.getAccessToken(channel),
    ) as { data?: MetaTemplate[] };

    return (data.data ?? []).map((t) => ({
      name: t.name,
      languageCode: t.language,
      status: normalizeMetaTemplateStatus(t.status),
      category: t.category,
      body: t.components?.find((c) => c.type === "BODY")?.text ?? "",
    }));
  }

  async createTemplate(channelId: string, t: TemplateDefinition): Promise<ProviderTemplate> {
    const channel = this.channels.get(channelId);
    if (!channel?.metaWabaId) throw new Error("Missing WABA ID");

    const payload = {
      name: t.name,
      language: t.languageCode,
      category: t.category,
      components: [
        {
          type: "BODY",
          text: t.body,
        }
      ]
    };

    const data = await this.callMetaAPI(`/${channel.metaWabaId}/message_templates`, "POST", this.getAccessToken(channel), payload) as { status?: string };

    return {
      name: t.name,
      languageCode: t.languageCode,
      status: normalizeMetaTemplateStatus(data.status),
      category: t.category,
      body: t.body,
    };
  }

  onInbound(handler: (e: NormalizedInboundEvent) => Promise<void>): void {
    this.inboundHandlers.push(handler);
  }

  onStatusUpdate(handler: (e: NormalizedStatusEvent) => Promise<void>): void {
    this.statusHandlers.push(handler);
  }
}

export const cloudApiAdapter: WhatsAppProvider = new CloudApiProvider();
