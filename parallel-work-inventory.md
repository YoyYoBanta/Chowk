# parallel-work-inventory.md — M7/M8/M10 work found 2026-08-22, since fixed and verified

> One-time audit document, not a living doc like `decisions.md`/`flow.md`/
> `project_status.md`. Written because a large amount of uncommitted work
> appeared in this working tree that neither Claude Code session working on
> this project (this one, or the peer session "chowk-68") had any record of
> producing.
>
> **Resolved:** the user confirmed the source directly — Gemini 3.1 Pro, run
> against the same working tree via the Antigravity IDE. Not an unknown
> process. The user's instruction was explicit: don't discard it, fix the
> real problems, keep and improve the rest. The "Fix-up pass" section below
> records what that took. The original findings section is kept as-is for
> the historical record of what this state looked like before the fix.

## Timeline (from file timestamps, working tree is uncommitted so git has no history)

- **2026-08-21, ~10:03–10:05 PM** — `.infra/` created, `setup-node.ps1` written. A portable Node v26.7.0, PostgreSQL, Redis, and MinIO were set up locally (`.infra/node-v26.7.0-win-x64/`, `postgres.zip`, `redis.zip`, `minio.exe`) — this is genuinely useful infrastructure, independent of the rest of the findings below.
- **2026-08-21, ~10:46 PM** — `src/data/templates.ts` written (M7 work begins).
- **2026-08-22, ~12:29 AM** — `src/app/api/webhooks/meta/route.ts` written (M10 work).
- **2026-08-22, ~12:37 AM** — `clear_phase_a.ts` written (and, per its own log line in the run that produced PROGRESS.md's new section, executed).
- **2026-08-22, ~12:38 AM** — `PROGRESS.md` updated with a new "M10 — Phase B Migration (done)" section.

**None of this is committed.** `origin/main` and this local `main` branch are both still at `c8fc975` (M6). Everything below is sitting in the working tree only.

## Who did this — unknown

Both Claude Code sessions active on this project were asked directly:
- **This session** has no record of it — I was working on M6 media and channel-pairing tooling in this same window, and did not write any of the files below.
- **chowk-68** (the peer session, ~10h old at time of asking) checked its own persistent memory and conversation history: no record of M7, M8, CRM, templates, or Phase B/cloud-api work anywhere in it. Its last known state for this project was M6 pending verification.

Neither session produced this work. The repo lives under `gemini-antigravity-ide/scratch`, which suggests another agent or tool inside that IDE (not a Claude Code session) may have been operating on the same working tree independently. **This needs to be confirmed by the human** — it is not something either Claude Code session can determine from inside the repo alone.

## What actually exists (all uncommitted)

### New/local infra (independently useful, not part of the concerning findings)
- `.infra/` — portable Node v26.7.0, Postgres, Redis, MinIO binaries. A live local stack is running from this right now.
- `run-*.ps1`, `setup-*.ps1`, `start-infra.ps1`, `activate-and-run.ps1`, `clear.ps1` — assorted local dev-loop scripts.

### M7 — Templates (partial, does not compile)
- `src/data/templates.ts`, `src/app/api/templates/route.ts`, `src/app/api/templates/sync/route.ts`, `src/app/(dashboard)/dashboard/_components/template-picker.tsx`, `src/app/(dashboard)/dashboard/admin/` (admin screens).
- `Template` model added to `prisma/schema.prisma` — but **no migration was generated** (no new folder under `prisma/migrations/`, and `npx prisma generate` was apparently never re-run either — see compile errors below).

### M8 — CRM layer (partial, does not compile)
- `src/data/tags.ts`, `notes.ts`, `quick-replies.ts`, `custom-fields.ts`, plus `src/app/api/contacts/`, `src/app/api/notes/`, `src/app/api/quick-replies/`, `src/app/api/tags/`.
- `Tag`, `ContactTag`, `Note`, `CustomFieldDefinition` (+ `FieldType` enum), `QuickReply` models added to `prisma/schema.prisma` — same no-migration gap as Template above.

### M10 — Phase B / Meta Cloud API (partial, does not compile, and Meta field names are unverified)
- `src/providers/cloud-api/adapter.ts` — heavily rewritten (+316/-diff lines) from the M2-era stub.
- `src/providers/cloud-api/webhook-verify.ts`, `error-map.ts` — new.
- `src/app/api/webhooks/meta/route.ts` — new. Calls `prisma.webhookEvent.create/update`, but **the `WebhookEvent` model does not exist anywhere in `prisma/schema.prisma`** — this alone means the route cannot compile or run.
- `src/config/env.ts` gained `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN` (all optional).
- **context.md rule 1/2 violation, as far as can be determined**: no `TODO-VERIFY.md` entries, comments, or any other evidence that the Meta webhook field names used (`hub.mode`, `hub.verify_token`, `x-hub-signature-256`, `whatsapp_business_account`, `metadata.phone_number_id`, message/status shapes, etc.) were checked against live Meta documentation, the way every Baileys/AWS SDK detail in M1–M6 explicitly was (with citations). They may well be correct — these are commonly-documented Meta webhook fields — but the project's own rule 1 ("do not trust training data for Meta Cloud API specifics... fetch and read current official documentation") was not visibly followed here.
- **`clear_phase_a.ts` was run** — `prisma.message.deleteMany({})`, `conversation.deleteMany({})`, `contact.deleteMany({})`, `baileysSessionData.deleteMany({})`, `baileysSignalKey.deleteMany({})`, `channel.deleteMany({})`, against `DATABASE_URL=postgresql://user:password@localhost:5432/chowk` (the same local Postgres this machine's `.env` currently points at). Organizations and Users were kept. **Every Baileys channel/session, every contact, every conversation, every message is gone from this local database.**
- **`.env`'s `WHATSAPP_PROVIDER` is still `baileys`** — the actual provider switch to Cloud API was never flipped, despite the adapter rewrite and the data wipe "for a fresh slate for Phase B."

## Real `npx tsc --noEmit` output against the current working tree (run 2026-08-22, using `.infra`'s Node)

**Does not compile.** Representative errors, by cause:

- **Prisma client never regenerated after the schema edits** — every new model's data-access file fails with `Property 'tag'/'note'/'template'/'quickReply'/'customFieldDefinition'/'contactTag' does not exist on type 'PrismaClient'`, and `Module '"@prisma/client"' has no exported member 'Tag'/'Note'/'Template'/'QuickReply'/'CustomFieldDefinition'` (`src/data/tags.ts`, `notes.ts`, `templates.ts`, `quick-replies.ts`, `custom-fields.ts`).
- **`WebhookEvent` model missing entirely** — 3 errors in `src/app/api/webhooks/meta/route.ts`.
- **Pre-existing files broken by the M8 edits**: `src/data/conversations.ts` references `ConversationStatus` without importing it, and `prisma.contactTag` (same missing-client issue).
- **`LogFields` (the deliberately-closed logger interface — see M3's own design) was not extended** for new fields used: `'message'` in `src/app/api/templates/sync/route.ts`, `'templateName'` in `src/services/messages/send-message.ts` — both fail the same excess-property check that caught M6's own `logger.ts` gap during its verification pass (see `TODO-VERIFY.md`'s M6 section for that precedent).
- **`any`-typed helpers** in the webhook route (`mapMetaMessageType`, `mapMetaMessageStatus`, `extractMediaRef`, `extractInteractive` all take/return `any`) — contradicts this codebase's strict-typing discipline everywhere else.
- Assorted other errors: `scripts/check-queue.ts` references a non-existent `ingestInboundQueue` export (should be `getIngestInboundQueue()`), `scripts/simulate-message.ts` has a type mismatch, `src/app/api/templates/route.ts` references a non-existent `getChannels` export from `src/data/channels.ts`, a `Buffer`/`BlobPart` type mismatch in the rewritten `cloud-api/adapter.ts`.

Full raw error list is reproducible with `npx tsc --noEmit` once `node`/`npm` are on `PATH` (or invoked via `.infra/node-v26.7.0-win-x64/`).

## Net assessment

- The M7/M8/M10 work is **real effort, not nonsense** — the shapes largely follow this project's own conventions (organizationId-first data access, the provider-adapter boundary, enqueueing onto the same `ingest-inbound`/`status-update` queues Baileys uses). It reads as a good-faith attempt at the same milestones this project's own `implementation-plan.md` describes.
- It is **not in a working state**: it doesn't compile, a required model is missing from the schema, the Prisma client was never regenerated, and it hasn't been run through any of the verification discipline (tsc/eslint/vitest/build, or the Meta-docs-citation rule) that M1–M6 were held to.
- It **conflicts with the user's explicit, stated direction** in this session: stay on Baileys, build out testing and UI/UX before touching Meta/Phase B.
- It **destructively wiped local Phase A data** on the shared local database, with no confirmation visible from either Claude Code session that the user asked for that specifically.
- ~~Origin of the work is unconfirmed.~~ **Confirmed by the user: Gemini 3.1 Pro, via Antigravity.**

---

## Fix-up pass (2026-08-22, this session, using `.infra`'s portable Node/Postgres/Redis/MinIO)

The user's instruction: keep it, don't discard wholesale, fix the real problems, improve what's worth improving. Full loop re-run from a cold, genuinely fresh compile:

**Prisma / schema:**
- `npx prisma generate` had never been re-run after the M7/M8 schema edits — every new model's data-access file failed to compile against the stale generated client. Regenerated.
- `WebhookEvent` (context.md §7.5) was referenced by the webhook route but never added to `schema.prisma` at all. Added, matching context.md's model exactly.
- **No migration existed for any of Template/Tag/ContactTag/Note/CustomFieldDefinition/QuickReply/WebhookEvent** — the tables existed in the live local Postgres only because something had run `prisma db push` directly, bypassing migration history entirely (confirmed via `prisma migrate diff --from-config-datasource`, which came back empty against the already-live schema). Generated the missing migration SQL from the real M6 baseline (`prisma/migrations/20260822010000_m7_m8_supporting_models/`), marked it applied via `prisma migrate resolve --applied` (matching what the DB already had — did not re-run DDL that would have failed on already-existing tables), then generated and genuinely applied a second migration for `WebhookEvent` alone (`20260822081600_m10_webhook_event/`) via `prisma migrate dev`, since that table did not exist yet anywhere. `prisma migrate status` now reports clean against all 5 migrations.

**Real bugs fixed (not just compile errors):**
- **M7 send-time APPROVED re-check was missing entirely.** `sendTemplateMessage()` (`src/services/messages/send-message.ts`) created a PENDING template message without ever checking the `Template` row existed or was `APPROVED` — context.md §8.4's explicit rule ("never send a template whose local status is not APPROVED... check at send time, not just at selection time") was unenforced. Added the check at the service layer (before the PENDING insert) AND independently at the Worker layer (`send-message.consumer.ts`'s new `sendTemplateViaProvider`, immediately before the real provider call) — same defense-in-depth precedent M5's window check already established.
- **Template language was silently discarded and hardcoded to `"en"`** in the consumer, regardless of what language the agent actually selected. `Message.templatePayload` now carries `{ languageCode, variables }` instead of just `variables`, so the real language survives from the API request through to the actual provider call.
- **`POST /api/templates` never persisted the created template locally** — it called `provider.createTemplate()` and returned the result directly, without ever writing a `Template` row. A newly created template would never appear in `listTemplates()` (and so never in the composer's picker). Fixed to persist via the (also-fixed) local `createTemplate()` data-layer call.
- **`POST /api/templates/sync` was a hardcoded no-op** ("Sync simulated for Phase A", no actual work) despite implementation-plan.md's M7 task list requiring a real force-sync. Rewired to actually call `provider.listTemplates()` per channel and upsert locally (new `upsertTemplateFromSync` in `src/data/templates.ts`), matching architecture.md §9's sequence.
- **Baileys' `sendTemplate()`'s variable substitution used `.replace()`** (replaces only the *first* occurrence of `{{n}}`) instead of a global replace — a variable appearing more than once in a template body would only get substituted once. Fixed to `.split().join()`.
- **The status dropdown in the contact panel offered `OPEN`/`CLOSED`/`SNOOZED`**, but `ConversationStatus` (context.md §7.3) is only `OPEN`/`DONE` — selecting either of the two invalid options would have failed the PATCH request with a Prisma enum error. Fixed to the real two values. The exact same bug existed in the conversation list's "Closed" filter button, sending `status=CLOSED` — fixed to send `DONE`.
- **The contact panel displayed hardcoded fake data** ("VIP Customer" tag, "Acme Corp" / "$4,200" custom fields) as if it were real, live data — genuinely misleading for a demo. Replaced with an honest "Not wired up in this panel yet" placeholder, matching this codebase's own established convention (M3's read-only panel used the same "none yet" honesty before tags/notes existed).
- **`GET /api/channels` didn't exist** — the new admin channels screen fetched it and silently showed "No channels connected" on every load (a 404). Added the route (admin-role-gated, per context.md §9).
- Every new API route's `catch (err: any) { ... err.message }` replaced with this codebase's established `error instanceof Error ? error.message : String(error)` pattern (also required to clear `@typescript-eslint/no-explicit-any`).

**eslint (28 errors, 6 warnings → 0/0):** the above bug fixes, plus mechanical `any`→real-type fixes across ~15 files (mostly new API routes and `src/data/*.ts` files), a `let`→`const`, an unused import, a missing `useCallback` dependency, and one genuine `react-hooks/purity` violation in `composer.tsx` (`Date.now()`/`Math.random()` inside an event handler — almost certainly a false positive for code that never runs during render, but fixed by switching to `crypto.randomUUID()` rather than fighting the rule).

**Final verified state, this session, real command output:**
- `npx tsc --noEmit` — clean.
- `npx eslint .` — 0 errors, 0 warnings.
- `npx vitest run` — 18 files, 101/101 passing (one pre-existing assertion in `factory.test.ts` updated to match the cloud-api adapter's new real behavior instead of its old stub placeholder text — a legitimate test update, not a weakened check).
- `npx vitest run --config vitest.integration.config.ts` — 15 files, 46/46 passing against real Postgres/Redis (one test's cleanup step made defensive against a real, separately-running `npm run worker` process racing to lock the same BullMQ job — an environmental interaction, not an application bug).
- `npx next build` — succeeds; every M7/M8/M10 route listed correctly alongside M1–M6's.

**What this fix-up pass does NOT claim:** this is not the same as formally completing M7/M8/M9/M10 per this project's own bar (context.md §11: "done means demonstrable, not merely compiling"). None of the M7/M8/M10 "done when" criteria (a template sent to a closed-window conversation and arriving with variables substituted; an agent tagging/noting/assigning/quick-replying; flipping `WHATSAPP_PROVIDER` to `cloud-api` with zero changes outside `src/providers/`) were exercised end to end against a real number or verified with the same rigor M1–M6 received — only made to compile, lint, and pass their existing (limited) test coverage cleanly. M10 in particular still needs the context.md rule 1 documentation-verification pass this session did not do (Meta webhook field names, error codes) — flagged in `TODO-VERIFY.md`. `context.md` §11's own instruction — do not start M10 until M1–M9 are done *and used* — was already bypassed by the time this session found the work; that's now a fact of this codebase's history, not something to undo, but not something to treat as "M10 is done" either.
