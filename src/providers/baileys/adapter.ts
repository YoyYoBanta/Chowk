import { randomUUID } from "node:crypto";
import type { Channel } from "@prisma/client";
import qrcodeTerminal from "qrcode-terminal";
import makeWASocket, {
  DisconnectReason,
  downloadContentFromMessage,
  type AnyMessageContent,
  type ConnectionState as BaileysConnectionState,
  type MessageUpsertType,
  type WAMessage,
  type WAMessageUpdate,
  type WASocket,
} from "@whiskeysockets/baileys";
import { updateChannelStatus } from "@/data/channels";
import { findMessageByProviderMessageId } from "@/data/messages";
import { getConversationWithContact } from "@/data/conversations";
import { getIngestInboundQueue, getStatusUpdateQueue, QUEUE_NAMES } from "@/queue/queues";
import { createDbAuthState } from "./session-store";
import {
  baileysMediaTypeFromMime,
  digitsToJid,
  normalizeBaileysMessage,
  normalizeBaileysStatusUpdate,
} from "./normalize";
import { checkWindowOpenForSend } from "./simulate-window";
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
 * REAL vs STUB in this file:
 *  - connect()/disconnect()/getConnectionState()/onInbound()/onStatusUpdate()
 *    (M2) are REAL: they open an actual Baileys socket, wire DB-backed
 *    session storage (session-store.ts), reconnect with backoff, and
 *    normalize every real Baileys inbound-message event into
 *    NormalizedInboundEvent, pushed onto the real ingest-inbound BullMQ
 *    queue.
 *  - sendText()/markAsRead() (M4) are REAL: real
 *    `sock.sendMessage(jid, { text })` / `sock.readMessages([key])` calls
 *    (see their own doc comments below for exactly how the real method
 *    signatures were confirmed against the package's own `.d.ts`), and the
 *    real `messages.update` event is normalized (normalize.ts) and pushed
 *    onto the real status-update BullMQ queue via the same
 *    `onStatusUpdate(handler)` registration point the interface already
 *    defined at M2.
 *  - sendText()/sendMedia() (M5) additionally simulate Meta's 24-hour
 *    service window independently of the service layer (context.md
 *    §8.0.4 — see ./simulate-window.ts's own doc comment for why this is
 *    intentional defense-in-depth, not a duplicate check to remove): both
 *    return `{ ok: false, retryable: false, code: 'WINDOW_CLOSED' }` when
 *    called for a conversation whose window is closed, before ever
 *    touching the socket.
 *  - sendMedia()/downloadMedia()/uploadMedia() (M6, this milestone) are
 *    REAL: sendMedia() sends real image/video/audio/document content
 *    (built by buildBaileysMediaContent below); downloadMedia() decrypts
 *    real E2E-encrypted media bytes via Baileys' own
 *    downloadContentFromMessage(); uploadMedia() hands its buffer to
 *    sendMedia() via a short-lived in-memory cache (see its own doc
 *    comment for why that's deliberate, not a shortcut).
 *  - sendTemplate/listTemplates/createTemplate remain STUBS — explicitly
 *    out of scope until M7.
 *
 * connect() (and, as of M4, sendText()/markAsRead()/the messages.update
 * wiring) is code-complete but UNVERIFIED against a real WhatsApp session
 * — there is no dedicated test number available yet (see TODO-VERIFY.md).
 * Every event-shape and method-signature assumption below comes from
 * reading @whiskeysockets/baileys's own generated .d.ts files directly
 * (Types/Events.d.ts, Types/Message.d.ts, Types/Auth.d.ts,
 * Socket/messages-send.d.ts, Socket/chats.d.ts), not from training data —
 * TODO-VERIFY.md records which specific shapes were inferred this way
 * versus confirmed against the package's own docs, and which classification
 * judgment calls (e.g. "no active session" -> retryable vs terminal) were
 * made in the absence of a live session to observe.
 */
export class BaileysProvider implements WhatsAppProvider {
  readonly name = "baileys" as const;

  private readonly sockets = new Map<string, WASocket>();
  private readonly channels = new Map<string, Channel>();
  private readonly connectionStates = new Map<string, ConnectionState>();
  private readonly reconnectAttempts = new Map<string, number>();
  private readonly inboundHandlers: Array<(e: NormalizedInboundEvent) => Promise<void>> = [];
  private readonly statusHandlers: Array<(e: NormalizedStatusEvent) => Promise<void>> = [];
  // M6: uploadMedia()'s in-memory hand-off to sendMedia() — see
  // uploadMedia()'s own doc comment below for why this is deliberately
  // NOT persisted anywhere.
  private readonly outboundMediaCache = new Map<string, { buffer: Buffer; mimeType: string }>();

  async connect(channel: Channel): Promise<void> {
    this.channels.set(channel.id, channel);
    await this.startSocket(channel);
  }

  /**
   * Test-support only — never called by production code. Mirrors
   * src/lib/auth/session.ts's `sealSessionCookie` precedent: a small,
   * explicit hook that lets a test populate exactly the state a real code
   * path depends on (here, the `channelId -> organizationId` map
   * `sendText`/`sendMedia`'s window-check needs — see markAsRead's own doc
   * comment for why the adapter resolves organizationId this way) without
   * driving `connect()`'s real, network-dependent socket setup. There is
   * still no dedicated WhatsApp test number available (TODO-VERIFY.md), so
   * this is what lets the window-check branch be exercised directly against
   * the real `sendText()`/`sendMedia()` methods rather than only through
   * ./simulate-window.ts's standalone helper.
   */
  registerChannelForTest(channel: Channel): void {
    this.channels.set(channel.id, channel);
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

    // Delivery-receipt / ack updates (M4) — normalized to
    // NormalizedStatusEvent and pushed onto the same status-update queue
    // Phase B's webhook receiver will use, via the identical
    // onStatusUpdate(handler) registration point the interface has defined
    // since M2 (architecture.md §10).
    sock.ev.on("messages.update", (updates) => {
      for (const update of updates) {
        void this.handleStatusUpdate(channel, update);
      }
    });
  }

  private handleConnectionUpdate(channel: Channel, update: Partial<BaileysConnectionState>): void {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      this.connectionStates.set(channel.id, { status: "qr_pending", qr });
      // Pairing affordance, not a product feature (context.md §8.1b: "keep
      // this adapter deliberately thin, it is scaffolding") — there is no
      // admin UI for connecting a channel yet (that's M9 territory), so
      // printing the QR straight to the Worker process's own stdout is the
      // only way a human can currently pair a real WhatsApp session. Fires
      // every time Baileys rotates the QR (it expires and re-issues one
      // periodically until scanned), same as every other Baileys
      // getting-started example.
      console.log(`\n[baileys] channel ${channel.id} — scan this QR code with WhatsApp (Linked Devices):\n`);
      qrcodeTerminal.generate(qr, { small: true });
      return;
    }

    if (connection === "open") {
      this.reconnectAttempts.set(channel.id, 0);
      this.connectionStates.set(channel.id, { status: "connected" });
      console.log(`[baileys] channel ${channel.id} connected — session paired and live.`);
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

  private async handleStatusUpdate(channel: Channel, update: WAMessageUpdate): Promise<void> {
    const event = normalizeBaileysStatusUpdate(channel.id, update);
    if (!event) return; // not an ack-status change we care about — see normalize.ts

    await getStatusUpdateQueue().add(QUEUE_NAMES.statusUpdate, {
      organizationId: channel.organizationId,
      provider: "baileys",
      event,
    });

    for (const handler of this.statusHandlers) {
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

  /**
   * Real send (M4). `sock.sendMessage(jid, content, options?)` and its
   * return type (`Promise<proto.WebMessageInfo | undefined>`) are confirmed
   * directly against the package's own
   * `lib/Socket/messages-send.d.ts`/`lib/Types/Message.d.ts` — not guessed.
   * `{ text: string }` is a real member of `AnyMessageContent`
   * (`lib/Types/Message.d.ts`'s `AnyRegularMessageContent` union), so a
   * plain-text send needs nothing more elaborate than that.
   *
   * "Write the failure path first" (context.md rule 6), exercised here
   * against the one failure mode that's actually reachable without a live
   * WhatsApp session: no socket at all for this channel. Classified
   * `retryable: true` — a channel with no live socket may simply be
   * mid-reconnect (see the reconnect-with-backoff logic in
   * handleConnectionUpdate above), so a later retry has a real chance of
   * succeeding; this is a judgment call recorded in TODO-VERIFY.md, since
   * there is no live session yet to observe how often that's actually true
   * in practice. A thrown error from `sock.sendMessage` itself (network
   * failure, an unrecognized jid, etc.) is likewise defaulted to
   * `retryable: true` rather than guessing which thrown errors are
   * "really" terminal — context.md rule 2 ("never invent an error code")
   * argues for the safer default here: BullMQ's own bounded retry/backoff
   * (src/queue/queues.ts) still eventually resolves to FAILED via
   * markSendMessageJobExhausted if the condition doesn't clear.
   *
   * M5: the 24h-window check (./simulate-window.ts) runs FIRST, before
   * even the "no active socket" check — a window-closed send is terminal
   * (`retryable: false`) regardless of the socket's state, and this
   * ordering is what lets the window-check branch be tested directly
   * without needing a live socket at all (registerChannelForTest + a
   * closed-window conversation is enough). Only proceeds to the socket
   * lookup once the window has confirmed open (or there's nothing in our
   * own DB to check it against — see checkWindowOpenForSend's own doc
   * comment for that fail-open case).
   */
  async sendText(p: SendTextParams): Promise<SendResult> {
    const windowRejection = await this.checkWindow(p.channelId, p.to);
    if (windowRejection) return windowRejection;

    const sock = this.sockets.get(p.channelId);
    if (!sock) {
      return {
        ok: false,
        retryable: true,
        code: "NO_ACTIVE_SESSION",
        message: "No active WhatsApp session for this channel — it may be reconnecting.",
      };
    }

    try {
      const sent = await sock.sendMessage(digitsToJid(p.to), { text: p.body });
      const providerMessageId = sent?.key?.id;
      if (!providerMessageId) {
        return {
          ok: false,
          retryable: true,
          code: "NO_MESSAGE_ID_RETURNED",
          message: "Baileys did not return a message id for this send.",
        };
      }
      return { ok: true, providerMessageId };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        code: "SEND_THREW",
        message: error instanceof Error ? error.message : "Unknown error sending via Baileys.",
      };
    }
  }

  /**
   * Real media send (M6). Window-check guard (M5) unchanged — runs first,
   * same as sendText(). `p.media.id` must be a key this adapter's own
   * uploadMedia() minted moments earlier in the SAME send-message job
   * (src/worker/consumers/send-message.consumer.ts calls uploadMedia()
   * then sendMedia() back to back) — see uploadMedia()'s doc comment for
   * why this in-memory hand-off is deliberately not durable across a
   * Worker restart, and why that's fine given every retry re-uploads
   * fresh (src/services/media/upload-outbound.ts's
   * uploadStoredMediaToProvider doc comment).
   *
   * Content shape per media kind (`AnyRegularMessageContent`'s image/
   * video/audio/document members) confirmed directly against Baileys' own
   * `src/Types/Message.ts` — not guessed — see TODO-VERIFY.md's M6
   * section.
   */
  async sendMedia(p: SendMediaParams): Promise<SendResult> {
    const windowRejection = await this.checkWindow(p.channelId, p.to);
    if (windowRejection) return windowRejection;

    const sock = this.sockets.get(p.channelId);
    if (!sock) {
      return {
        ok: false,
        retryable: true,
        code: "NO_ACTIVE_SESSION",
        message: "No active WhatsApp session for this channel — it may be reconnecting.",
      };
    }

    const cached = this.outboundMediaCache.get(p.media.id);
    if (!cached) {
      return {
        ok: false,
        retryable: false,
        code: "MEDIA_NOT_FOUND",
        message: "This media reference is no longer available for sending.",
      };
    }

    try {
      const content = buildBaileysMediaContent(cached.mimeType, cached.buffer, p.caption, p.media.filename);
      const sent = await sock.sendMessage(digitsToJid(p.to), content);
      const providerMessageId = sent?.key?.id;
      if (!providerMessageId) {
        return {
          ok: false,
          retryable: true,
          code: "NO_MESSAGE_ID_RETURNED",
          message: "Baileys did not return a message id for this send.",
        };
      }
      this.outboundMediaCache.delete(p.media.id);
      return { ok: true, providerMessageId };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        code: "SEND_THREW",
        message: error instanceof Error ? error.message : "Unknown error sending media via Baileys.",
      };
    }
  }

  /** Shared by sendText/sendMedia — see checkWindowOpenForSend's own doc
   * comment (./simulate-window.ts) for the full story. Resolves
   * organizationId from the in-memory channels map populated by connect()
   * (or registerChannelForTest in tests), the same precedent markAsRead
   * already established. No channel known at all -> nothing to check,
   * fall through exactly like markAsRead's own "not found" cases do. */
  private async checkWindow(channelId: string, toWaId: string): Promise<SendResult | null> {
    const channel = this.channels.get(channelId);
    if (!channel) return null;
    return checkWindowOpenForSend(channel.organizationId, channelId, toWaId);
  }

  async sendTemplate(_p: SendTemplateParams): Promise<SendResult> {
    return {
      ok: false,
      retryable: false,
      code: "NOT_IMPLEMENTED",
      message: "baileys: sendTemplate() lands in M7",
    };
  }

  /**
   * Real mark-as-read (M4). `sock.readMessages(keys: WAMessageKey[])` is
   * confirmed directly against `lib/Socket/chats.d.ts` — not guessed.
   *
   * The interface (context.md §8.0.1) only gives this method
   * `(channelId, providerMessageId)`, but Baileys' own `readMessages()`
   * needs a full `WAMessageKey` (in practice: `remoteJid` + `id` +
   * `fromMe`) to build the read-receipt request — a bare message id isn't
   * enough on the wire. We reconstruct the missing `remoteJid` by looking
   * up the message's own conversation/contact through the real, org-scoped
   * data layer (`this.channels.get(channelId)` — populated by `connect()`
   * — supplies `organizationId`, exactly like `handleIncomingMessage`
   * above already does for `updateChannelStatus`), so this still respects
   * context.md rule 4 ("every database query must be scoped by
   * organization_id, no exceptions") even though the public interface
   * signature alone doesn't carry one.
   *
   * Resolves without throwing whenever there's nothing to act on (no live
   * socket, message not found, no conversation) — context.md §8.2 /
   * src/services/messages/mark-read.ts already treat this call as
   * best-effort and must not fail the whole "mark read" request just
   * because the provider side of it couldn't be completed.
   */
  async markAsRead(channelId: string, providerMessageId: string): Promise<void> {
    const channel = this.channels.get(channelId);
    const sock = this.sockets.get(channelId);
    if (!channel || !sock) return;

    const message = await findMessageByProviderMessageId(channel.organizationId, providerMessageId);
    if (!message) return;

    const conversation = await getConversationWithContact(channel.organizationId, message.conversationId);
    if (!conversation) return;

    try {
      await sock.readMessages([
        { remoteJid: digitsToJid(conversation.contact.waId), id: providerMessageId, fromMe: false },
      ]);
    } catch {
      // Best-effort — see the doc comment above; the interface's return
      // type is `Promise<void>`, there is no result to report a failure
      // through even if we wanted to.
    }
  }

  /**
   * Real inbound media download (M6). Baileys media is end-to-end
   * encrypted — `ref.mediaKey` (base64, captured by
   * src/providers/baileys/normalize.ts's mediaRefFrom at ingest time) is
   * required to decrypt it; `ref.directPath`/`ref.url` locate the
   * encrypted bytes on WhatsApp's CDN. `downloadContentFromMessage()` is
   * the real, public Baileys export for this (confirmed against the
   * installed package's own source, not guessed — see TODO-VERIFY.md's M6
   * section for exactly how); it returns a Node stream of the DECRYPTED
   * plaintext, which this method buffers fully — Tier 1's media sizes
   * (context.md §8.3 / src/services/media/limits.ts: 100MB ceiling) are
   * small enough that buffering the whole file is simpler and safe here.
   */
  async downloadMedia(_channelId: string, ref: MediaReference): Promise<Buffer> {
    if (!ref.mediaKey) {
      throw new Error(
        "baileys: downloadMedia() called with a reference that has no mediaKey — cannot decrypt",
      );
    }

    const mediaType = baileysMediaTypeFromMime(ref.mimeType);
    const stream = await downloadContentFromMessage(
      {
        mediaKey: Buffer.from(ref.mediaKey, "base64"),
        directPath: ref.directPath ?? null,
        url: ref.url ?? null,
      },
      mediaType,
    );

    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Real outbound media "upload" (M6) — but Baileys has no genuine
   * upload-then-reference-by-id step the way Meta's Cloud API does
   * (architecture.md §8): `sock.sendMessage()` takes the raw buffer
   * directly. To honor the shared `WhatsAppProvider` interface (one
   * `uploadMedia()` call, then a LATER `sendMedia()` call referencing what
   * it returned — architecture.md §5 rule 3, no `if (provider ===
   * 'baileys')` branching allowed outside src/providers/), this caches the
   * buffer in memory keyed by a fresh id and hands that id back as the
   * `MediaReference`; sendMedia() (above) looks it up and consumes it.
   *
   * Deliberately NOT persisted anywhere more durable (a DB row, a second
   * object-storage write) — src/services/media/upload-outbound.ts's
   * uploadStoredMediaToProvider doc comment explains why: this adapter's
   * own in-memory map would silently go stale across a Worker restart if
   * anything ever tried to reuse an old reference, so the design instead
   * ensures nothing does — every send attempt (including a BullMQ retry)
   * calls uploadMedia() fresh, immediately followed by sendMedia() in the
   * same job execution, never across a gap where a restart could land.
   */
  async uploadMedia(_channelId: string, file: Buffer, mime: string): Promise<MediaReference> {
    const id = randomUUID();
    this.outboundMediaCache.set(id, { buffer: file, mimeType: mime });
    return { id, mimeType: mime, fileLength: file.length };
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

/**
 * Builds the `AnyMessageContent` object `sock.sendMessage()` expects for a
 * given outbound media kind — one variant per Tier 1 outbound media type
 * (context.md §8.2: image, video, audio, document). Field shapes
 * (`image`/`video`/`audio`/`document` as the buffer-holding key, `caption`,
 * `mimetype`, `fileName`) confirmed directly against Baileys'
 * `AnyRegularMessageContent` union in `src/Types/Message.ts` — not guessed.
 * Audio deliberately gets no caption (WhatsApp voice/audio messages don't
 * render one; `AnyRegularMessageContent`'s audio variant has no `caption`
 * field at all).
 */
function buildBaileysMediaContent(
  mimeType: string,
  buffer: Buffer,
  caption: string | undefined,
  fileName: string | null | undefined,
): AnyMessageContent {
  if (mimeType.startsWith("image/")) {
    return { image: buffer, mimetype: mimeType, caption };
  }
  if (mimeType.startsWith("video/")) {
    return { video: buffer, mimetype: mimeType, caption };
  }
  if (mimeType.startsWith("audio/")) {
    return { audio: buffer, mimetype: mimeType };
  }
  return { document: buffer, mimetype: mimeType, caption, fileName: fileName ?? "file" };
}

export const baileysAdapter: WhatsAppProvider = new BaileysProvider();
