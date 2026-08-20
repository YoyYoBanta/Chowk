import type { Channel } from "@prisma/client";
import makeWASocket, {
  DisconnectReason,
  type ConnectionState as BaileysConnectionState,
  type MessageUpsertType,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { updateChannelStatus } from "@/data/channels";
import { getIngestInboundQueue, QUEUE_NAMES } from "@/queue/queues";
import { createDbAuthState } from "./session-store";
import { normalizeBaileysMessage } from "./normalize";
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
 * Baileys (Phase A / unofficial WhatsApp Web protocol) adapter.
 *
 * Package: @whiskeysockets/baileys — see TODO-VERIFY.md's M2 section for
 * exactly how the version was chosen (registry's own "latest" dist-tag at
 * the time, currently a 7.x release candidate; the 6.7.x line is
 * available under the registry's "legacy" dist-tag if the maintainer
 * prefers more stability before a real test number is in the picture).
 *
 * REAL vs STUB in this file, deliberately split along the M2 task list:
 *  - connect()/disconnect()/getConnectionState()/onInbound()/onStatusUpdate()
 *    are REAL: they open an actual Baileys socket, wire DB-backed session
 *    storage (session-store.ts), reconnect with backoff, and normalize
 *    every real Baileys inbound-message event into NormalizedInboundEvent,
 *    pushed onto the real ingest-inbound BullMQ queue.
 *  - sendText/sendMedia/sendTemplate/markAsRead/downloadMedia/uploadMedia/
 *    listTemplates/createTemplate are STUBS. Explicitly out of scope per
 *    the M2 task list's non-goals ("No outbound send implementation beyond
 *    the stub interface methods (M4)", "No media download pipeline (M6)",
 *    "no templates (M7)") — implementing them for real belongs to those
 *    later milestones, including the Meta-parity simulation work
 *    (window check, template rendering, rate limiting) context.md §8.0.4
 *    describes for this adapter.
 *
 * connect() is code-complete but UNVERIFIED against a real WhatsApp
 * session — there is no dedicated test number available yet (see
 * TODO-VERIFY.md). Every event-shape assumption below comes from reading
 * @whiskeysockets/baileys's own generated .d.ts files directly (Types/
 * Events.d.ts, Types/Message.d.ts, Types/Auth.d.ts), not from training
 * data — TODO-VERIFY.md records which specific shapes were inferred this
 * way versus confirmed against the package's own docs.
 */
class BaileysProvider implements WhatsAppProvider {
  readonly name = "baileys" as const;

  private readonly sockets = new Map<string, WASocket>();
  private readonly channels = new Map<string, Channel>();
  private readonly connectionStates = new Map<string, ConnectionState>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly inboundHandlers: Array<(e: NormalizedInboundEvent) => Promise<void>> = [];
  private readonly statusHandlers: Array<(e: NormalizedStatusEvent) => Promise<void>> = [];

  async connect(channel: Channel): Promise<void> {
    this.channels.set(channel.id, channel);
    await this.startSocket(channel);
  }

  private async startSocket(channel: Channel): Promise<void> {
    const { state, saveCreds } = await createDbAuthState(channel.id);

    const sock = makeWASocket({ auth: state });
    this.sockets.set(channel.id, sock);
    this.connectionStates.set(channel.id, { status: "connecting" });

    sock.ev.on("creds.update", () => void saveCreds());

    sock.ev.on("connection.update", (update: Partial<BaileysConnectionState>) => {
      this.handleConnectionUpdate(channel, update);
    });

    // Live messages (context.md §8.1b: "the worker holds a live socket per
    // channel and subscribes to message events").
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const msg of messages) {
        void this.handleIncomingMessage(channel, msg, type);
      }
    });

    // Bulk history-sync replay on connect — deduplicated through the exact
    // same enqueue -> ingest-inbound-consumer path as live events (context.md
    // §8.1b: "Baileys emits history-sync and other bulk events on connect.
    // Deduplicate on providerMessageId exactly as in Phase B").
    sock.ev.on("messaging-history.set", ({ messages }) => {
      for (const msg of messages) {
        void this.handleIncomingMessage(channel, msg, "append");
      }
    });
  }

  private handleConnectionUpdate(channel: Channel, update: Partial<BaileysConnectionState>): void {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      this.connectionStates.set(channel.id, { status: "qr_pending", qr });
      return;
    }

    if (connection === "open") {
      this.reconnectAttempts.set(channel.id, 0);
      this.connectionStates.set(channel.id, { status: "connected" });
      return;
    }

    if (connection === "close") {
      // Boom errors carry `.output.statusCode`; duck-typed rather than
      // importing @hapi/boom's type directly since it's only Baileys' own
      // transitive dependency, not one of ours.
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      this.sockets.delete(channel.id);

      if (loggedOut) {
        // Auth failure: mark DISCONNECTED and stop — do not loop-retry
        // (context.md §8.1b: "On auth failure, mark the channel
        // DISCONNECTED and surface it in the admin UI. Do not retry an
        // auth failure in a loop.").
        this.connectionStates.set(channel.id, { status: "disconnected", reason: "logged_out" });
        void updateChannelStatus(channel.organizationId, channel.id, "DISCONNECTED");
        console.error(
          `[baileys] channel ${channel.id} logged out — not retrying, marked DISCONNECTED`,
        );
        return;
      }

      // Any other close reason: reconnect with exponential backoff.
      const attempt = (this.reconnectAttempts.get(channel.id) ?? 0) + 1;
      this.reconnectAttempts.set(channel.id, attempt);
      const delayMs = Math.min(30_000, 1_000 * 2 ** attempt);
      this.connectionStates.set(channel.id, { status: "connecting" });
      console.warn(
        `[baileys] channel ${channel.id} disconnected (statusCode=${statusCode ?? "unknown"}), reconnect attempt ${attempt} in ${delayMs}ms`,
      );
      setTimeout(() => {
        void this.startSocket(channel);
      }, delayMs);
    }
  }

  private async handleIncomingMessage(
    channel: Channel,
    msg: WAMessage,
    _upsertType: MessageUpsertType,
  ): Promise<void> {
    const event = normalizeBaileysMessage(channel.id, msg);
    if (!event) return; // our own outbound echo, or a message with no usable key/content

    // Real enqueue onto the real ingest-inbound queue (architecture.md §6).
    // organizationId comes from the Channel object handed to connect() —
    // never from a channelId-only DB lookup (see src/queue/queues.ts's doc
    // comment for why that matters to src/data/'s organizationId-first rule).
    await getIngestInboundQueue().add(QUEUE_NAMES.ingestInbound, {
      organizationId: channel.organizationId,
      provider: "baileys",
      event,
    });

    for (const handler of this.inboundHandlers) {
      await handler(event);
    }
  }

  async disconnect(channelId: string): Promise<void> {
    const sock = this.sockets.get(channelId);
    if (sock) {
      try {
        sock.end(undefined);
      } catch {
        // socket already closed — nothing to clean up
      }
      this.sockets.delete(channelId);
    }
    this.connectionStates.set(channelId, { status: "disconnected" });
  }

  async getConnectionState(channelId: string): Promise<ConnectionState> {
    return this.connectionStates.get(channelId) ?? { status: "disconnected" };
  }

  // --- Stubs: out of scope for M2, see the class doc comment above. ------

  async sendText(_p: SendTextParams): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      code: "NOT_IMPLEMENTED",
      message: "baileys: sendText() lands in M4",
    };
  }

  async sendMedia(_p: SendMediaParams): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      code: "NOT_IMPLEMENTED",
      message: "baileys: sendMedia() lands in M4/M6",
    };
  }

  async sendTemplate(_p: SendTemplateParams): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      code: "NOT_IMPLEMENTED",
      message: "baileys: sendTemplate() lands in M7",
    };
  }

  async markAsRead(_channelId: string, _providerMessageId: string): Promise<void> {
    throw new Error("baileys: markAsRead() lands in M4");
  }

  async downloadMedia(_channelId: string, _ref: MediaReference): Promise<Buffer> {
    throw new Error("baileys: downloadMedia() lands in M6");
  }

  async uploadMedia(_channelId: string, _file: Buffer, _mime: string): Promise<MediaReference> {
    throw new Error("baileys: uploadMedia() lands in M6");
  }

  async listTemplates(_channelId: string): Promise<ProviderTemplate[]> {
    return [];
  }

  async createTemplate(_channelId: string, _t: TemplateDefinition): Promise<ProviderTemplate> {
    throw new Error("baileys: createTemplate() lands in M7");
  }

  onInbound(handler: (e: NormalizedInboundEvent) => Promise<void>): void {
    this.inboundHandlers.push(handler);
  }

  onStatusUpdate(handler: (e: NormalizedStatusEvent) => Promise<void>): void {
    this.statusHandlers.push(handler);
  }
}

export const baileysAdapter: WhatsAppProvider = new BaileysProvider();
