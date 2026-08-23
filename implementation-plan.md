# implementation-plan.md — Chowk, phase-wise build plan (Tier 1)

> Companion to `context.md` (scope, rules, data model, product spec) and `architecture.md` (components, data flow, repo layout). This file turns those into a phase-by-phase execution plan: what to build, in what order, in which files, with what tests, and what "done" looks like. It does not introduce new scope or new architecture — every task here traces back to a section in one of the other two files.

**How to use this document:** work top to bottom. Do not start a phase until the previous phase's "Done when" is demonstrated, not just compiling (context.md §0 rule 3, §11). At the end of each phase, update `PROGRESS.md` with what works, what is stubbed, and what needs human verification (context.md §0 rule 7).

---

## 0. Pre-M1 — repo scaffold

Not a milestone on its own; this is the one-time setup the plan assumes is in place before M1 work starts.

- [ ] Initialize the repo with the directory layout in `architecture.md` §4 (`src/app`, `src/api`, `src/providers`, `src/services`, `src/data`, `src/queue`, `src/worker`, `src/config`, `src/lib`, `prisma/`).
- [ ] `src/config/branding.ts` — export `PRODUCT_NAME = "Chowk"`. Confirm nothing else hardcodes the name (context.md header note).
- [ ] `src/config/env.ts` — Zod-validated environment schema, including `WHATSAPP_PROVIDER`, DB URL, Redis URL, object storage credentials, session secret. Fail fast on missing/invalid env.
- [ ] `TODO-VERIFY.md` and `PROGRESS.md` created at repo root, empty, ready for use per context.md §0 rules 1 and 7.
- [ ] Vitest configured (context.md §6).
- [ ] Base ESLint config in place (the provider-boundary rule itself is added at M2 per architecture.md §5, not before — Baileys doesn't exist yet).

**Open decision to raise now, not later** (context.md §14 item 3): object storage provider. Needed by M6 at the latest, but pin the choice early since `src/config/env.ts` and later the media services depend on its SDK shape. Ask, don't assume.

---

## M1 — Skeleton and tenancy

**Objective:** Two organizations, two users, a login flow, and provable data isolation. No WhatsApp code yet.

**Builds on:** architecture.md §12 (tenancy enforcement architecture), §4 (repo layout: `src/data/`, `src/lib/auth/`).

**Tasks:**
- [ ] `prisma/schema.prisma` — `Organization`, `User`, `Role` enum exactly as context.md §7.1.
- [ ] `src/lib/auth/` — session-based auth, email + password (context.md §6). Session payload carries `userId`, `organizationId`, `role`.
- [ ] `src/data/organizations.ts`, `src/data/users.ts` — every exported function takes `organizationId` as a required first argument (architecture.md §12). No function may query `User` or any future table without it.
- [ ] Login page (`src/app/login/`), empty authenticated shell layout (`src/app/(dashboard)/`), role gate middleware/HOC that redirects non-authenticated requests and distinguishes ADMIN vs AGENT at the route level.
- [ ] Seed script (context.md §12) — create 2 orgs, 2+ users each, varying roles. This seed script is reused and extended in every later milestone, so build it to be extensible now.

**Tests (context.md §13, architecture.md §12):**
- [ ] Cross-tenant isolation test: log in as a user in Org A, attempt to fetch/query a resource belonging to Org B (once such resources exist — for M1 this can be a `User` lookup), assert empty/404. This test pattern is the template every later milestone's tenancy tests will copy.
- [ ] Auth: cannot access dashboard routes unauthenticated; role gate blocks AGENT from any route reserved for ADMIN (none exist yet, but the mechanism must be provably wired — test with a placeholder admin-only route if needed).

**Done when (context.md §11, M1):** two users in two organisations can log in and cannot see each other's data — proven by a passing cross-tenant test.

**Do not build yet:** anything under `src/providers/`, `src/queue/`, `src/worker/`. No Channel, Contact, Conversation, or Message models yet — those belong to M2+.

---

## M2 — Provider adapter + ingestion (Phase A)

**Objective:** A real WhatsApp message sent to a dedicated test number becomes a row in the `Message` table, exactly once, and a stub Cloud API provider proves the abstraction holds.

**Builds on:** architecture.md §5 (enforcing the boundary), §6 (inbound data flow), §13 (queue design).

**Open decision to resolve before starting (context.md §14 item 1):** confirm the dedicated Phase A test number. Do not proceed with a number carrying real relationships.

**Tasks, in dependency order:**

1. **Interface first** (architecture.md §5, rule 2 — "one factory, one call site"):
   - [ ] `src/providers/types.ts` — `WhatsAppProvider` interface, `NormalizedInboundEvent`, `NormalizedStatusEvent`, `SendResult`, exactly as context.md §8.0.1–8.0.2.
   - [ ] `src/providers/factory.ts` — reads `WHATSAPP_PROVIDER` once, returns a `WhatsAppProvider`.

2. **Data model additions** (context.md §7.2–7.4):
   - [ ] `Channel`, `Contact`, `Conversation`, `Message` models + `Direction`, `MessageType`, `MessageStatus` enums in `prisma/schema.prisma`. Include `UNSUPPORTED` in `MessageType` from day one (context.md §7.4).
   - [ ] `src/data/channels.ts`, `src/data/contacts.ts`, `src/data/conversations.ts`, `src/data/messages.ts` — same `organizationId`-required pattern as M1.

3. **Queue + worker skeleton** (architecture.md §13, §3):
   - [ ] `src/queue/connection.ts`, `src/queue/queues.ts` — Redis connection, `ingest-inbound` queue defined.
   - [ ] `src/worker/index.ts` — process entrypoint. Must be run as a standalone long-lived process, never serverless (architecture.md §3, §14).
   - [ ] `src/worker/consumers/ingest-inbound.consumer.ts` — implements the dedupe → upsert → persist logic from architecture.md §6:
     - dedupe on `(provider, providerMessageId)` before any write
     - upsert `Contact` by `(organizationId, waId)`
     - upsert `Conversation` by `(channelId, contactId)`
     - set `lastInboundAt`, `lastMessageAt`, increment `unreadCount`
     - insert `Message` row
     - unknown type → `UNSUPPORTED` + preserve `raw`, never throw

4. **Baileys adapter** (context.md §8.1b, architecture.md §4):
   - [ ] `src/providers/baileys/adapter.ts` — implements `WhatsAppProvider`. `connect()` opens the socket, `onInbound()` normalizes every event to `NormalizedInboundEvent` and pushes to `ingest-inbound`.
   - [ ] `src/providers/baileys/session-store.ts` — persists session credentials to Postgres or object storage, keyed by channel. Never local disk (context.md §8.1b).
   - [ ] Reconnect with exponential backoff on disconnect; on auth failure, mark channel `DISCONNECTED`, do not loop-retry (context.md §8.1b).
   - [ ] Deduplicate Baileys history-sync bulk events on connect using the same `providerMessageId` dedupe path — this is the first real exercise of the dedupe mechanism (context.md §8.1b).

5. **Cloud API stub** (the actual acceptance test for this milestone):
   - [ ] `src/providers/cloud-api/adapter.ts` — implements `WhatsAppProvider` with method bodies stubbed (can throw "not implemented" or return placeholder values), but it must **compile** against the same interface and be selectable via `WHATSAPP_PROVIDER=cloud-api` without touching anything outside `src/providers/`.

6. **Enforce the boundary now, not later** (architecture.md §5):
   - [ ] Add the ESLint `no-restricted-imports` rule forbidding imports from `src/providers/baileys/**` (or the `baileys` package) outside that directory.

**Tests:**
- [ ] Dedupe test: replay the same `NormalizedInboundEvent` twice through the consumer, assert exactly one `Message` row.
- [ ] Upsert race test (if feasible at this stage): concurrent delivery of two events for a brand-new contact does not create duplicate `Contact`/`Conversation` rows.
- [ ] `UNSUPPORTED` fallback test: an event with an unmapped type does not crash the consumer and is stored correctly.

**Done when (context.md §11, M2):** a real message sent from a personal phone to the dedicated test number appears as a row in `Message` within two seconds; replaying the same event creates exactly one row; the stub `cloud-api` provider compiles and is selectable by env var without touching any file outside `src/providers/`.

> If the stub doesn't slot in cleanly, stop and fix the interface before M3 (context.md §11 M2 note, architecture.md §5).

---

## M3 — Read-only inbox

**Objective:** Agents can see conversations and message history update live, with no send capability yet.

**Builds on:** architecture.md §11 (realtime delivery), §4 (repo layout: `src/app/(dashboard)`, `src/services/realtime/`).

**Tasks:**
- [ ] `GET /api/conversations`, `GET /api/conversations/:id`, `GET /api/conversations/:id/messages` (context.md §9) — cursor-paginated from the start (context.md §9, "offset pagination will break").
- [ ] Conversation list UI (context.md §10.2): contact name/number, last message preview, relative timestamp, unread badge, assigned agent avatar (assignment itself is M8, but the field renders if present), channel indicator.
- [ ] Thread view (context.md §10.3): reverse-chronological, infinite scroll upward, outbound right/inbound left, render every `MessageType` including a neutral placeholder for `UNSUPPORTED`.
- [ ] Contact panel, read-only (context.md §10.5): name, phone, tags/custom fields/notes shown but not editable yet.
- [ ] `src/services/realtime/publish.ts` + `GET /api/events` SSE endpoint (architecture.md §11) — Worker's `ingest-inbound` consumer publishes on new message; Web's SSE handler subscribes per-connection, scoped by `organizationId`.
- [ ] Client-side `EventSource` with reconnect; on reconnect, re-fetch the affected thread/list to reconcile (architecture.md §11 — SSE is a convenience channel, not source of truth).

**Tests:**
- [ ] Realtime smoke test: message ingested → SSE event received by a connected client within the target latency.
- [ ] Tenancy: conversation list/detail endpoints respect `organizationId` from session (extend the M1 cross-tenant test pattern to `Conversation`).

**Done when (context.md §11, M3):** a message sent from a phone appears in the open browser thread within two seconds with no refresh.

---

## M4 — Outbound text

**Objective:** Agents can reply; delivery status ticks progress correctly; failures surface clearly.

**Builds on:** architecture.md §7 (outbound send data flow), §10 (failure modes: crash-mid-send, stale status).

**Tasks:**
- [ ] `src/services/messages/send-message.ts` — implements the sequence in architecture.md §7: check conversation access → (window check is a no-op stub until M5, or gate behind a feature flag if you want to build it now — but the milestone's own scope is text-only, so keep window enforcement out until M5 per context.md build order) → insert `Message` row as `PENDING` → enqueue `send-message` job → return 202.
- [ ] `src/queue/jobs/send-message.job.ts`, `src/worker/consumers/send-message.consumer.ts` — loads `Message` by id (never carries payload, architecture.md §13), calls `provider.sendText()`, updates `providerMessageId` + `SENT` on success, `FAILED` + error fields on terminal failure, re-enqueues with backoff on retryable failure.
- [ ] `POST /api/conversations/:id/messages` route wired to the service.
- [ ] Status-update path: `src/worker/consumers/status-update.consumer.ts` (new) — find `Message` by `providerMessageId`, apply **only if status moves forward** in `PENDING → SENT → DELIVERED → READ` (or `→ FAILED`); log-and-drop if the message isn't found yet (architecture.md §10).
- [ ] `POST /api/conversations/:id/read` — mark-as-read, calls provider's `markAsRead()`, resets `unreadCount` locally (context.md §8.2).
- [ ] Thread UI: tick indicator per message status; human-readable error message on `FAILED` (context.md §10.3) — never a raw error code alone.

**Tests:**
- [ ] Status progression unit test (context.md §13 names this explicitly as a correctness-bug hotspot): feed statuses out of order, assert forward-only application, assert a `SENT` arriving after `READ` is ignored.
- [ ] Crash-recovery reasoning check: confirm the `Message` row exists as `PENDING` before the provider call is made (this is a code-review point, not just a test — verify the ordering in `send-message.ts`).

**Done when (context.md §11, M4):** an agent replies from the UI, the message arrives on the phone, and the tick indicator progresses to read.

---

## M5 — The 24-hour window

**Objective:** The product enforces Meta's rule even though Baileys doesn't — this is the milestone context.md §1.3 calls out as the one most likely to get skipped if Phase A behavior is allowed to leak into the product.

**Builds on:** architecture.md §7 (window check placement), context.md §4.1, §10.4.

**Tasks:**
- [ ] `src/services/window.ts` — the **one** place `isWindowOpen` is computed: `lastInboundAt != null && now - lastInboundAt < 24h` (context.md §7.3). No boolean is ever stored.
- [ ] Wire the check into `send-message.ts` (already scaffolded in M4): free-form send + window closed → reject with `409 { code: 'WINDOW_CLOSED', message }` **before** enqueueing (architecture.md §7). Template sends bypass this check.
- [ ] `src/providers/baileys/simulate-window.ts` (context.md §8.0.4) — the Baileys adapter must independently enforce this at the adapter layer too (`sendText`/`sendMedia` return `{ ok: false, retryable: false, code: 'WINDOW_CLOSED' }` when called outside the window), so Phase A behavior matches Phase B even if a caller bypasses the service layer.
- [ ] Composer UI (context.md §10.4): two mutually exclusive states driven by server-provided window state — open (free text + remaining-time display) vs. closed (free text disabled, only "Send a template" action, non-technical explanation). Template picker itself is stubbed/disabled until M7; for M5 it's enough that the closed state is correctly shown and free text is blocked.
- [ ] Conversation list closing-soon indicator (context.md §10.2): subtle indicator when window closes in under 2 hours.

**Tests:**
- [ ] Window calculation unit test (context.md §13 correctness hotspot #1): boundary cases at exactly 24h, just under, just over, `lastInboundAt = null`.
- [ ] API bypass test: a conversation with `lastInboundAt` > 24h old, a direct API call attempting a free-form send is rejected with the structured error — **not** merely blocked in the UI (context.md §11, M5 done criterion explicitly calls this out).

**Done when (context.md §11, M5):** with a conversation whose last inbound is over 24 hours old, the composer is in closed state and a direct API call bypassing the UI is rejected with a structured error.

---

## M6 — Media

**Objective:** Media survives Meta's short-lived URLs and renders correctly on both ends, indefinitely.

**Builds on:** architecture.md §8 (media data flow), context.md §4.4, §8.3.

**Open decision resolved at Pre-M1** should now actually be wired: object storage provider client.

**Tasks:**
- [ ] `Media` model (context.md §7.5).
- [ ] `src/queue/jobs/download-media.job.ts`, `src/worker/consumers/download-media.consumer.ts` — enqueued **in the same tick** as the message insert inside `ingest-inbound.consumer.ts` (architecture.md §8, §6) whenever the inbound event carries media. Downloads via `provider.downloadMedia()`, uploads to object storage, inserts `Media` row, links `Message.mediaId`.
- [ ] `src/services/media/upload-outbound.ts` — for outbound sends with attachments: `provider.uploadMedia()` first (adapter uploads to Meta, returns media ID in Phase B / or just stores directly in Phase A per context.md §8.0.4), then send referencing that ID; also store our own copy regardless.
- [ ] File size / MIME type validation before upload (context.md §8.3) — flag exact current limits as unverified in `TODO-VERIFY.md` per context.md §0 rule 1 if not yet confirmed against live docs.
- [ ] Thread rendering for every media type (context.md §10.3): image inline + lightbox, video inline player, audio player, document filename+download, location map link/coordinates.
- [ ] Composer attachment picker wired to `upload-outbound.ts`.

**Tests:**
- [ ] Inbound media pipeline test: simulate a media event, assert the download job fires immediately (not lazily) and a `Media` row + linked `Message` exist.
- [ ] Round-trip test: an outbound media send stores a local copy that's independent of Meta's retention.

**Done when (context.md §11, M6):** an image sent from a phone renders in the thread, and an image sent from the UI arrives on the phone. Both still render 24 hours later.

---

## M7 — Templates

**Objective:** Full template lifecycle — sync, create, pick, send with variables — with Meta (or its Phase A simulation) as source of truth.

**Builds on:** architecture.md §9 (template sync data flow), context.md §4.2, §8.0.4, §8.4, §8.5.

**Tasks:**
- [x] `Template` model (context.md §7.5) — `status` stored as a raw string, not enumed, since Meta adds values.
- [x] `src/worker/scheduler.ts` entry — runs every 15 minutes and on channel connect (context.md §8.4), calls `provider.listTemplates()`, upserts locally via `src/services/templates/sync.ts` (no separate `src/queue/jobs/sync-templates.job.ts` file — the sync logic is a plain async function shared by the scheduler and the force-sync route, not a BullMQ job of its own; functionally equivalent, no queue needed for a self-triggered interval).
- [x] Baileys template simulation (context.md §8.0.4) — implemented inline in `src/providers/baileys/adapter.ts` rather than a separate `simulate-templates.ts` file: `listTemplates` reads the local `Template` table; `sendTemplate` renders variables into text and sends as text; `createTemplate` writes locally with status `APPROVED` immediately.
- [x] `POST /api/templates` (create + submit), `POST /api/templates/sync` (force sync), `GET /api/templates` (filter by channel/status) — context.md §9.
- [x] **Send-time re-check**, not just selection-time: `send-message.ts`'s template path verifies `status === 'APPROVED'` immediately before calling `provider.sendTemplate()`, and the Worker (`send-message.consumer.ts`) independently re-checks again immediately before the real provider call.
- [x] Variable substitution validation (context.md §8.5): `sendTemplateMessage()` validates every `{{n}}` placeholder has a non-empty supplied value before creating any row (`src/lib/templates/variables.ts`); the template picker presents one input per variable with a live preview of the substituted body.
- [x] Template picker UI wired into the composer's "closed window" state (from M5) and available generally via a template button when the window is open (context.md §10.4).
- [x] Admin template screen (context.md §10.6): list, status (including rejection reasons), create.

**Tests:**
- [x] Variable substitution unit test (context.md §13 correctness hotspot): `src/lib/templates/variables.test.ts` — mismatched variable count is caught before the provider call, with a clear error naming the missing keys.
- [x] Send-time status gate test: `send-message.template.integration.test.ts` — a template `APPROVED` at selection time that flips to `REJECTED` before the Worker runs is blocked at send (FAILED/TEMPLATE_NOT_APPROVED, provider never called).

**Done when (context.md §11, M7):** a template is sent to a conversation with a closed window and arrives correctly with variables substituted. **Met** — proved via the mocked-provider integration test; real delivery to a live phone via Baileys' actual `sendText()` substitution path is unverified against a live number (see TODO-VERIFY.md).

---

## M8 — CRM layer

**Objective:** The organizational/workflow features around conversations — tags, notes, custom fields, assignment, quick replies.

**Builds on:** context.md §7.5 (Tag, ContactTag, Note, CustomFieldDefinition, QuickReply models), §9 (API surface), §10.5–10.6.

**Tasks:**
- [x] Models: `Tag`, `ContactTag`, `Note`, `CustomFieldDefinition`, `QuickReply` (context.md §7.5). `ContactTag`/`Note` also gained real `@relation` fields with `onDelete: Cascade` (not present in the original pass — see decisions.md).
- [x] `src/data/` additions for each, same `organizationId`-required pattern.
- [x] API routes: `/api/contacts/:id` (PATCH for displayName + custom fields), `/api/contacts/:id/tags` (GET/POST/DELETE), `/api/contacts/:id/notes` (GET/POST), `/api/notes/:id` (PATCH/DELETE), `/api/tags` (GET/POST) + `/api/tags/:id` (PATCH/DELETE), `/api/quick-replies` (full CRUD) — context.md §9.
- [x] `PATCH /api/conversations/:id` — assign/unassign to an agent, set OPEN/DONE status.
- [x] Contact panel made editable (context.md §10.5): name (click-to-rename), tags inline add/remove, custom fields (type-validated on save), notes with author+timestamp, assignment control, status toggle.
- [x] Conversation list filters (context.md §10.2): All / Unassigned / Mine / Done, by channel, by tag.
- [x] Quick reply `/` shortcut in the composer (context.md §10.4, §7.5) — insertable snippet; media attachment on a quick reply is modeled (`QuickReply.mediaId`) but not yet exercised by the composer's insert flow.
- [x] Admin screens for Users (invite/role/deactivate — `User.isActive`, a temporary password returned on invite since no email delivery exists), Tags, Custom field definitions, Quick replies (context.md §10.6) — Channels and Templates admin screens already exist from M2/M7.

**Tests:**
- [x] Tenancy tests extended to every new model (`src/data/crm-tenancy.integration.test.ts`): Tag, ContactTag, Note, CustomFieldDefinition, QuickReply — cross-tenant read returns nothing.

**Done when (context.md §11, M8):** an agent can tag a contact, write a note, assign the conversation to a colleague, and insert a quick reply. **Met** — every step proved via real Postgres integration tests and exercised through the actual UI components, not just the data layer.

---

## M9 — Search and hardening

**Objective:** Production-readiness pass — search, pagination everywhere, logging, resilience.

**Builds on:** architecture.md §13 (queue idempotency), §16 (observability), §17 (failure modes table), context.md §12, §13.

**Tasks:**
- [ ] Conversation search + in-thread search (context.md §2.1 F8, §10.2) — backed by appropriate Postgres indexing/full-text search; verify the 10,000+ message performance target before calling this done.
- [ ] Audit every list endpoint for cursor pagination (context.md §9 — "every list endpoint is cursor-paginated"); fix any that slipped through as offset-based in earlier milestones.
- [ ] Structured JSON logging (architecture.md §16): every log entry carries `organizationId` and a correlation id threaded from the originating webhook/socket event or API request through every queue hop. Confirm no `Message.body` or media content ever reaches a log line (context.md §12).
- [ ] Error boundaries in the UI (context.md §12).
- [ ] Retry policy audit on every queue per architecture.md §13: confirm `retryable` vs `terminal` classification is correctly wired end-to-end from `provider.sendText()`'s `SendResult` through to the consumer's backoff-or-fail branch.
- [ ] Worker restart resilience: verify every consumer is idempotent and DB-state-driven (architecture.md §13, §17) — deliberately kill the Worker process mid-queue during a load test and confirm no message is lost or duplicated.
- [ ] Admin channel screen: quality rating and messaging tier displayed, read directly from Meta sync data, never computed locally (context.md §4.3).
- [ ] Reconciliation pass for stuck `PENDING` messages (mentioned as a hardening item in architecture.md §7) — a scheduled job that flags/re-checks `Message` rows stuck in `PENDING` past a timeout.

**Tests:**
- [ ] Load-seeded search correctness + latency test at 10,000+ messages.
- [ ] Forced-restart-mid-queue test — the explicit M9 acceptance criterion.
- [ ] Full run-through of context.md §13's four correctness hotspots as a regression suite: window calculation, status progression, signature verification (stubbed until M10's real webhook, but the Baileys-side equivalent — dedupe/idempotency — should already be covered), variable substitution.

**Done when (context.md §11, M9):** search returns correct results across 10,000+ seeded messages in under a second, and the worker recovers cleanly from a forced restart mid-queue.

> Do not start M10 until M1–M9 are done **and used** (context.md §11) — this is a deliberate pause for real internal usage to surface issues before touching the transport.

---

## M10 — Phase B migration

**Objective:** Flip one environment variable and get a fully working inbox on Meta's official Cloud API, with zero changes outside `src/providers/`.

**Builds on:** architecture.md §14 (deployment topology proof), §5 (boundary enforcement), context.md §8.0.5 (migration checklist), §8.1 (webhook receiver spec).

**Open decisions to resolve before starting (context.md §14):**
- Item 2: connection mode — fresh number on Cloud API vs. Coexistence (behavioral limits differ).
- Item 6: whether Phase A message history migrates or the migration starts clean.

**Tasks — work through context.md §8.0.5's checklist, mapped to files:**
- [ ] **Before writing any Meta API call**, fetch and read current docs at `https://developers.facebook.com/docs/whatsapp/cloud-api` (context.md §0 rule 1). Anything that can't be verified gets written behind the interface, stubbed, and flagged in `TODO-VERIFY.md` (already scaffolded pre-M1).
- [ ] `src/providers/cloud-api/adapter.ts` — replace the M2 stub with the real implementation of every `WhatsAppProvider` method.
- [ ] `src/providers/cloud-api/webhook-verify.ts` — HMAC-SHA256 verification against the app secret, computed over the **raw** request body read before JSON parsing (context.md §8.1, architecture.md §15).
- [ ] `src/app/api/webhooks/meta/route.ts` — GET (challenge/verify-token echo, 403 on mismatch) and POST (verify signature → insert `WebhookEvent` → enqueue `ingest-inbound`/`status-update` job → return 200 in under 200ms) per context.md §8.1 and architecture.md §6, §15. This route must stay thin — no DB upserts, no Meta calls inline (architecture.md §3).
- [ ] `src/providers/cloud-api/error-map.ts` — map Meta's structured error codes into `retryable` vs `terminal` buckets (context.md §4.7). Look up current codes in live docs; never invent one (context.md §0 rule 2).
- [ ] Real template sync against the Cloud API (context.md §8.4) replacing the Phase A local-table simulation.
- [ ] Real media upload/download against Cloud API's two-step (get URL, then authenticated GET) flow (context.md §4.4, §8.3).
- [ ] Confirm the ESLint boundary rule still passes with zero violations (architecture.md §5) — this is the mechanical proof the swap didn't leak.
- [ ] Deploy the webhook receiver at a public HTTPS URL, register with Meta, configure app secret + verify token (context.md §8.0.5).
- [ ] Recreate templates directly in Meta and await approval — Phase A's simulated templates are not real templates (context.md §8.0.5) and do not carry over automatically.
- [ ] Resolve the message-history-migration decision from context.md §14 item 6 and execute whichever path was chosen.

**Tests:**
- [ ] Full manual test checklist from context.md §13 run against a real Cloud API number.
- [ ] Re-run the M2 dedupe/UNSUPPORTED tests, M4 status-progression tests, M5 window tests, M7 variable-substitution tests — all should pass unchanged against the real provider, since they were written against the transport-agnostic layer.

**Done when (context.md §11, M10):** flipping `WHATSAPP_PROVIDER` to `cloud-api` produces a fully working inbox with **zero changes to any file outside `src/providers/`**, and the full manual test checklist passes against a real Cloud API number.

> If this milestone requires touching the UI, API routes, or the worker, the adapter abstraction failed its purpose — fix the abstraction rather than patch around it (context.md §11, M10 note).

---

## Open decisions checkpoint (context.md §14)

Track these against the milestones above; do not decide any unilaterally:

| # | Decision | Must be resolved by |
|---|---|---|
| 1 | Phase A dedicated test number | Before M2 |
| 2 | Phase B connection mode (fresh vs. Coexistence) | Before M10 |
| 3 | Object storage provider | Pre-M1 / before M6 in practice |
| 4 | Shared vs. per-agent numbers | Affects UI emphasis — flag before M8 admin/UX decisions harden |
| 5 | Data retention policy | Before any real data volume accumulates — no later than M9 |
| 6 | Phase A history migration or clean start | Before M10 |
| 7 | Final product name | Before anything is printed, bought, or registered — not a code blocker |

---

## Cross-cutting rules that apply to every phase

Restated from context.md §0 because they're easy to let slip mid-milestone:

- Every database query scoped by `organizationId` — no exceptions, in every phase, not just M1.
- Write the failure path first for any webhook handler, send, or media download added in that phase.
- No file outside `src/providers/` may import a Baileys symbol at any point, including during M10.
- Update `PROGRESS.md` at the end of every milestone: what works, what is stubbed, what needs human verification.
