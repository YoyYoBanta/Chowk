# flow.md — how execution actually travels through this codebase

> Concrete, function-level call traces — not the conceptual component diagrams
> in `architecture.md` (those name components like "ingest-inbound consumer";
> this file names the actual functions and the actual order they run in).
> Kept in sync as code changes; a "currently editing" marker at the bottom
> points at whichever part of these paths is actively being worked on.
>
> Notation: `file.ts  functionName()` on its own line is a real call site.
> `↓` means "then, synchronously, in the same call stack." A horizontal rule
> marked `async boundary` means control passes to a different process (the
> Worker) via a BullMQ job — nothing below it runs in the same call stack as
> what's above it.

---

## Flow 1 — Inbound message (Baileys / Phase A)

```
1. src/providers/baileys/adapter.ts   BaileysProvider.startSocket()  (private)
   sock.ev.on("messages.upsert", ({ messages, type }) => ...)
   — fires when a real WhatsApp message arrives on the live socket
     ↓
2. src/providers/baileys/adapter.ts   BaileysProvider.handleIncomingMessage(channel, msg, type)  (private)
     ↓ calls
3. src/providers/baileys/normalize.ts   normalizeBaileysMessage(channelId, msg)
   pure, no I/O — maps the raw Baileys WAMessage to NormalizedInboundEvent | null
   (returns null for our own outbound echo, or unusable key/content)
     ↓ back in handleIncomingMessage, if non-null
4. src/queue/queues.ts   getIngestInboundQueue().add(QUEUE_NAMES.ingestInbound, {...})
   payload: { organizationId, provider: "baileys", event }

   ═══════════════ async boundary — BullMQ, new process (Worker) ═══════════════

5. src/worker/index.ts   startIngestInboundWorker()'s Worker callback
     ↓ calls
6. src/worker/consumers/ingest-inbound.consumer.ts   processIngestInboundJob(data)
   a. src/data/messages.ts       findMessageByProviderMessageId(orgId, providerMessageId)
      → if found: log + return (dedupe — replay is a no-op past here)
   b. src/data/contacts.ts       upsertContact(orgId, { waId, name })
   c. src/data/conversations.ts  upsertConversationForInbound(orgId, {...})
      sets lastInboundAt/lastMessageAt, unreadCount++
   d. src/data/messages.ts       createMessage(orgId, {...})
      mediaId is left null even if event.media is set — see Flow 2
   e. IF event.media:  src/queue/queues.ts  getDownloadMediaQueue().add(...)
      → branches into Flow 2, step 1, same tick, before this function returns
   f. src/services/realtime/publish.ts  publishMessageCreated(orgId, conversationId, message, {...})
      → branches into Flow 6
```

## Flow 2 — Inbound media download (branches off Flow 1, step 6e)

```
1. src/queue/queues.ts   getDownloadMediaQueue().add(QUEUE_NAMES.downloadMedia, {...})
   payload: { organizationId, provider, channelId, messageId, mediaRef }
   (called from ingest-inbound.consumer.ts, same tick as the message insert)

   ═══════════════ async boundary — BullMQ ═══════════════

2. src/worker/index.ts   startDownloadMediaWorker()'s Worker callback
     ↓ calls
3. src/worker/consumers/download-media.consumer.ts   processDownloadMediaJob(data)
   thin wrapper — just calls the service below with a fresh correlationId
     ↓ calls
4. src/services/media/download-and-store.ts   downloadAndStoreMedia(input)
   a. src/data/messages.ts        getMessageById(orgId, messageId)
      → not found, or mediaId already set (redelivered job): log + return
   b. src/providers/factory.ts    getWhatsAppProvider()
        ↓
      src/providers/baileys/adapter.ts   BaileysProvider.downloadMedia(channelId, ref)
        ↓ calls the real @whiskeysockets/baileys export
      downloadContentFromMessage({mediaKey, directPath, url}, mediaType)  → decrypted stream
      → buffered into a Buffer
   c. src/lib/storage/object-store.ts   putObject(storageKey, buffer, mimeType)
   d. src/data/media.ts            createMedia(orgId, {...})
   e. src/data/messages.ts         linkMessageMedia(orgId, messageId, media.id)
   f. src/data/messages.ts         getMessageById(...) again (fresh row)
   g. src/services/realtime/publish.ts   publishMessageUpdated(orgId, conversationId, updated, {...})
      → branches into Flow 6 (event type "message.updated")
```

## Flow 3 — Outbound text send

```
1. src/app/(dashboard)/dashboard/_components/composer.tsx   Composer.handleSend()
   optimistic add (onOptimisticAdd), then:
   fetch(`/api/conversations/${id}/messages`, { method: "POST", body: JSON {body} })
     ↓ HTTP request
2. src/app/api/conversations/[id]/messages/route.ts   POST()
   Content-Type: application/json branch — Zod-validates the body
     ↓ calls
3. src/services/messages/send-message.ts   sendTextMessage(input, opts)
   a. src/data/conversations.ts   getConversationById(orgId, conversationId)
      → not found: return 404 result, nothing written
   b. src/services/window.ts      isWindowOpen(conversation.lastInboundAt)
      → closed: return 409/WINDOW_CLOSED result, nothing written
   c. src/data/messages.ts        createPendingOutboundMessage(orgId, {...})
      status: PENDING, written BEFORE anything else below
   d. src/queue/queues.ts         getSendMessageQueue().add(QUEUE_NAMES.sendMessage, { orgId, messageId })
     ↓ back in the route
4. src/app/api/conversations/[id]/messages/route.ts   POST() (continued)
   src/data/media.ts   attachMediaSummary(orgId, result.message)  (media: null for text)
   → 202 { message } response
     ↓ HTTP response, back in the browser
5. src/app/(dashboard)/dashboard/_components/composer.tsx   handleSend() (continued)
   onServerAck(tempId, data.message) — replaces the optimistic row

   ═══════════════ async boundary — BullMQ (was already enqueued in step 3d) ═══════════════

6. src/worker/index.ts   startSendMessageWorker()'s Worker callback
     ↓ calls
7. src/worker/consumers/send-message.consumer.ts   processSendMessageJob(data)
   a. src/data/messages.ts        getMessageById(orgId, messageId)
   b. (idempotency guard: status !== PENDING → skip)
   c. src/data/conversations.ts   getConversationWithContact(orgId, conversationId)
   d. src/providers/factory.ts    getWhatsAppProvider()
        ↓
      src/providers/baileys/adapter.ts   BaileysProvider.sendText(p)
      checkWindow() first (defense-in-depth), then sock.sendMessage(jid, {text})
      → SendResult
   e. ok:true  → src/data/messages.ts  markMessageSent(orgId, messageId, providerMessageId)
      ok:false, retryable:true  → throw (BullMQ retries per queues.ts backoff config)
      ok:false, retryable:false → src/data/messages.ts  markMessageFailed(...)
   f. src/worker/consumers/send-message.consumer.ts   publishUpdatedStatus() (private)
        ↓ calls
      src/services/realtime/publish.ts   publishMessageStatusChanged(orgId, conversationId, updated, {...})
      → branches into Flow 6
```

## Flow 4 — Outbound media send

```
1. src/app/(dashboard)/dashboard/_components/composer.tsx   Composer.handleFileChange()
   optimistic add (local blob preview URL), then:
   fetch(`/api/conversations/${id}/messages`, { method: "POST", body: FormData{file, caption} })
     ↓ HTTP request
2. src/app/api/conversations/[id]/messages/route.ts   POST()
   Content-Type: multipart/form-data branch — request.formData(), File check
     ↓ calls
3. src/services/messages/send-message.ts   sendMediaMessage(input, opts)
   a. src/data/conversations.ts        getConversationById(...)  (same as Flow 3b)
   b. src/services/window.ts           isWindowOpen(...)  (same as Flow 3b)
   c. src/services/media/limits.ts     validateOutboundMedia(mimeType, size)
      → invalid: return 400/INVALID_MEDIA result, nothing written
   d. src/services/media/upload-outbound.ts   storeOutboundMedia(orgId, file, mimeType, fileName)
      → src/lib/storage/object-store.ts  putObject(...)
      → src/data/media.ts                createMedia(...)
   e. src/data/messages.ts             createPendingOutboundMessage(orgId, { mediaId: media.id, ... })
   f. src/queue/queues.ts              getSendMessageQueue().add(...)   (same queue as text sends)
     ↓ back in the route → 202 { message: attachMediaSummary(...) } → browser onServerAck

   ═══════════════ async boundary — BullMQ ═══════════════

4. src/worker/consumers/send-message.consumer.ts   processSendMessageJob(data)
   same steps a–c as Flow 3, then branches on message.type:
     ↓ message.type !== "TEXT" →
5. src/worker/consumers/send-message.consumer.ts   sendMediaViaProvider(orgId, conversation, message)  (private)
   a. src/data/media.ts                       getMediaById(orgId, message.mediaId)
      → missing mediaId or row: return terminal {ok:false, code, message} (no throw)
   b. src/services/media/upload-outbound.ts   uploadStoredMediaToProvider(channelId, media)
      → src/lib/storage/object-store.ts  getObjectBuffer(media.storageKey)
      → src/providers/factory.ts  getWhatsAppProvider()
          ↓
        src/providers/baileys/adapter.ts   BaileysProvider.uploadMedia(channelId, buffer, mime)
        caches the buffer in outboundMediaCache, returns a fresh MediaReference
   c. src/providers/baileys/adapter.ts   BaileysProvider.sendMedia(p)
      checkWindow() first, looks up outboundMediaCache by p.media.id,
      buildBaileysMediaContent() (private fn, bottom of adapter.ts), sock.sendMessage(...)
      → SendResult
     ↓ back in processSendMessageJob — same markMessageSent/markMessageFailed/
       publishUpdatedStatus steps as Flow 3e–f
```

## Flow 5 — Status update / delivery receipt (Baileys)

```
1. src/providers/baileys/adapter.ts   BaileysProvider.startSocket()  (private)
   sock.ev.on("messages.update", (updates) => ...)
     ↓
2. src/providers/baileys/adapter.ts   BaileysProvider.handleStatusUpdate(channel, update)  (private)
     ↓ calls
3. src/providers/baileys/normalize.ts   normalizeBaileysStatusUpdate(channelId, update)
   pure — maps Baileys' WAMessageStatus ack enum to NormalizedStatusEvent | null
     ↓ if non-null
4. src/queue/queues.ts   getStatusUpdateQueue().add(QUEUE_NAMES.statusUpdate, {...})

   ═══════════════ async boundary — BullMQ ═══════════════

5. src/worker/index.ts   startStatusUpdateWorker()'s Worker callback
     ↓ calls
6. src/worker/consumers/status-update.consumer.ts   processStatusUpdateJob(data)
   a. src/data/messages.ts   findMessageByProviderAndProviderMessageId(orgId, provider, providerMessageId)
      → not found: log + drop (short BullMQ retry covers the legit race, no infinite retry)
   b. src/lib/messages/status-progression.ts   statusesBelow(next.status)  (via applyForwardOnlyMessageStatus)
        ↓
      src/data/messages.ts   applyForwardOnlyMessageStatus(orgId, messageId, next)
      single atomic `UPDATE ... WHERE status IN (...)` — stale/out-of-order updates are silently ignored
   c. IF applied: src/services/realtime/publish.ts   publishMessageStatusChanged(...)
      → branches into Flow 6
```

## Flow 6 — Realtime delivery (SSE), fed by every publish above

```
1. src/services/realtime/publish.ts   publishMessageCreated / publishMessageStatusChanged / publishMessageUpdated
   a. src/data/media.ts   attachMediaSummary(orgId, message)  (wrapped in try/catch — never blocks the publish)
   b. getPublisher().publish(realtimeChannelForOrg(orgId), JSON.stringify(event))
      — one shared, lazily-connected ioredis publisher connection

   ═══ Redis pub/sub — no async boundary in the BullMQ sense, but a separate connection ═══

2. src/app/api/events/route.ts   GET()  (one long-lived connection per browser tab)
   on mount: src/services/realtime/publish.ts   subscribeToOrgEvents(orgId, onEvent)
   — opens a NEW ioredis subscriber connection, subscribed to exactly this org's channel
   onEvent(raw) → writes `data: <raw>\n\n` onto the SSE ReadableStream
     ↓ over the open HTTP connection
3. src/app/(dashboard)/_lib/use-realtime-events.ts   useRealtimeEvents(handleEvent, onReconnect)
   wraps a browser EventSource against /api/events
     ↓ calls the handler passed in by the consumer component
4. src/app/(dashboard)/dashboard/_components/thread-view.tsx   ThreadView's handleEvent(raw)
   JSON.parse → dispatch on parsed.type:
   "message.created"        → mergeById into state, scroll to bottom, maybe refetchWindowState()
   "message.status_changed" → update the row in place by id (or append if unseen)
   "message.updated"        → same as status_changed (media just became available)
```

## Flow 7 — Media serving to the browser

```
1. src/app/(dashboard)/dashboard/_components/message-bubble.tsx   ImageContent / DocumentContent / <video>/<audio>
   <img src={message.media.url}>  where url is always `/api/media/<mediaId>`
     ↓ browser issues a same-origin GET
2. src/app/api/media/[id]/route.ts   GET()
   a. src/lib/auth/guard.ts   requireApiSession(request)  → 401 if no session
   b. src/data/media.ts       getMediaById(orgId, mediaId)  → 404 if not found / wrong org
   c. src/lib/storage/object-store.ts   getObjectStream(media.storageKey)
   → new NextResponse(webStream, { headers: Content-Type/Length/Disposition/Cache-Control })
```

## Flow 8 — Auth / tenancy, on every authenticated request

```
1. src/app/(dashboard)/layout.tsx  (Server Component pages)  OR
   any src/app/api/**/route.ts handler  (API routes)
     ↓ calls
2. src/lib/auth/guard.ts   requireSession()  (pages, redirects to /login)
                         or requireApiSession(request)  (routes, 401 JSON)
     ↓ calls
3. src/lib/auth/session.ts   getCurrentSession()  or  getSessionFromRequest(request)
   iron-session reads/decrypts the session cookie → { userId, organizationId, role }
     ↓ back in the caller
4. Every src/data/*.ts function is then called with organizationId as its
   required first argument — this is the ONLY place organizationId enters
   the call chain; it never travels through a route param or request body.
```

## Flow 9 — Channel pairing (boot-time connect)

```
1. scripts/activate-channel.ts   main() → activate(channelId)
   a. src/data/organizations.ts   listOrganizations()
   b. src/data/channels.ts        listChannelsInOrg(orgId)  (per org, until the channel is found)
   c. src/data/channels.ts        updateChannelStatus(orgId, channelId, "ACTIVE")
   — run once, manually, from the CLI (`npm run activate-channel -- <channelId>`)

2. src/worker/index.ts   main()
     ↓ after starting all four BullMQ Workers
3. src/worker/index.ts   connectActiveChannels()
   a. src/data/organizations.ts   listOrganizations()
   b. src/data/channels.ts        listChannelsInOrg(orgId)  (per org)
   c. src/providers/factory.ts    getWhatsAppProvider()
        ↓ for every channel.status === "ACTIVE"
      src/providers/baileys/adapter.ts   BaileysProvider.connect(channel)
        ↓ calls (private)
      BaileysProvider.startSocket(channel)
      → src/providers/baileys/session-store.ts  createDbAuthState(channel.id)
        (loads any previously-persisted session — resumes silently if found)
      → makeWASocket({ auth: state })
      → sock.ev.on("connection.update", ...) registered  → see step 4

   ═══ no async boundary — this all happens synchronously during Worker boot ═══

4. src/providers/baileys/adapter.ts   BaileysProvider.handleConnectionUpdate(channel, update)  (private)
   IF no prior session (update.qr set):
     qrcodeTerminal.generate(qr, {small:true})  — printed to the Worker process's stdout
     (repeats each time Baileys rotates the QR, until scanned or the process exits)
   IF the phone scans it (or a prior session resumed): connection === "open"
     → connectionStates.set(channel.id, {status:"connected"}), console.log confirmation
     → from here on, real inbound messages flow through Flow 1
```

## Flow 10 — Scheduled jobs (template sync + stuck-message reconciliation)

```
1. src/worker/index.ts   main()
     ↓ after connectActiveChannels()
   src/worker/scheduler.ts   startTemplateSyncScheduler()
   src/worker/scheduler.ts   startStuckMessageReconciliationScheduler()
   both built on the shared private helper startScheduler(tick, intervalMs)
   — fires `tick` once immediately, then every intervalMs, returns {stop}

   ═══ template sync tick, every 15 min ═══
2a. src/services/templates/sync.ts   syncTemplatesForAllOrgs(orgIds)
    a. src/data/organizations.ts     listOrganizations()
    b. per org: src/services/templates/sync.ts   syncTemplatesForOrg(orgId)
       → src/data/channels.ts        listChannelsInOrg(orgId)
       → src/providers/factory.ts    getWhatsAppProvider()
       → per channel: provider.listTemplates(channelId)
       → src/data/templates.ts       upsertTemplateFromSync(...)  per template
    (a per-org failure is logged and skipped, never stops the sweep)

   ═══ stuck-message reconciliation tick, every 5 min ═══
2b. src/services/messages/reconcile-stuck.ts   reconcileStuckPendingMessagesForAllOrgs()
    a. src/data/organizations.ts     listOrganizations()
    b. per org: reconcileStuckPendingMessagesForOrg(orgId)
       → src/data/messages.ts        findStuckPendingMessages(orgId, cutoff)
         (status PENDING, direction OUTBOUND, createdAt older than 30 min)
       → per stuck message:
         src/data/messages.ts        markMessageFailed(orgId, id, "STUCK_PENDING_TIMEOUT", ...)
         src/data/messages.ts        getMessageById(orgId, id)  (fresh row)
         src/services/realtime/publish.ts   publishMessageStatusChanged(...)
         → branches into Flow 6

3. src/worker/index.ts   shutdown(signal)
   templateSyncScheduler.stop() / stuckMessageScheduler.stop()  → clearInterval
```

---

## Currently editing

_(Update this section to point at whatever part of the flows above is
actively being changed. When nothing is mid-change, it should say so rather
than go stale.)_

**As of 2026-08-24:** just finished M9 (search and hardening) — added Flow
10 (scheduled jobs: template sync + the new stuck-message reconciliation
sweep). In-thread search (`ThreadView`'s new search box → `GET
/api/conversations/:id/messages?search=`) branches off the existing message
list fetch in Flow 1/3's shared read path, not a new flow of its own. Nothing
is currently mid-change — M1–M9 are all now checklist-complete against
implementation-plan.md; M10 (Phase B) remains the next real milestone
whenever the human is ready.

**As of 2026-08-21 (historical):** just finished adding Flow 9 (channel pairing) —
`src/worker/index.ts`'s `connectActiveChannels()`, `scripts/activate-channel.ts`,
and the QR-printing addition to `src/providers/baileys/adapter.ts`'s
`handleConnectionUpdate`. This was needed because the maintainer is about to
pair a real (personal) WhatsApp number for live testing inside a GitHub
Codespace (due to lacking a local Node/Docker dev environment). M6's
verification agent already closed out Flows 1–4 and 7 for real (see
`PROGRESS.md`'s M6 section) — those are trustworthy now. Flow 9 itself has NOT
been run against a real phone yet; once the maintainer actually pairs, worth
confirming this flow matches reality (especially the QR-rotation behavior and
the resume-without-QR path on a second boot).
