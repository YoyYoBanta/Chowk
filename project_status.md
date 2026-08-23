# Current Status

> At-a-glance snapshot of Chowk (WhatsApp team-inbox platform), built in
> numbered milestones per `implementation-plan.md`. Kept short on purpose —
> for the full record see `PROGRESS.md` (exhaustive per-milestone detail),
> `TODO-VERIFY.md` (uncertain third-party API specifics), `decisions.md`
> (why behind implementation choices), and `flow.md` (execution traces).

## Completed
- M1 — Skeleton and tenancy (auth, Organization/User, role gate, cross-tenant isolation)
- M2 — Provider adapter + ingestion (Baileys adapter, Cloud API stub, Redis/BullMQ, dedupe/upsert pipeline)
- M3 — Read-only inbox (conversation list, thread view, contact panel, SSE realtime)
- M4 — Outbound text (send pipeline, status progression, mark-as-read)
- M5 — The 24-hour service window (window enforcement, composer states, countdown)
- M6 — Media (inbound download/store, outbound upload/send, thread rendering for every media type) — verified green (tsc/eslint/vitest/integration/build all passing against real Postgres+Redis+MinIO)
- M7 — Templates (scheduled sync, send-time APPROVED re-check, variable validation + live preview, template button in both window states, admin list+create screen with rejection reasons, both plan-mandated tests) — every box in implementation-plan.md's M7 task list checked off as of 2026-08-23, still Baileys-only, never exercised against a real Meta template review
- M8 — CRM layer (tags/notes/custom fields/quick replies, contact panel fully editable including name and assignment, channel+tag filters on the conversation list, a Users admin screen with real invite/role/deactivate, real Prisma relations on `ContactTag`/`Note`, tenancy tests for all five models) — every box in implementation-plan.md's M8 task list checked off as of 2026-08-23

## Currently Working On
- Real WhatsApp number pairing is done — a live Baileys session is paired and verified reconnecting cleanly from stored credentials (no re-scan needed) as of 2026-08-22. Next: exercising real send/receive traffic through the UI now that a live channel exists.

## Pending
- **M10 — Phase B/Meta Cloud API, partial, not formally done.** Gemini 3.1 Pro (via Antigravity, confirmed by the user) built a real Cloud API adapter/webhook receiver out of order and uncommitted, including a destructive Phase A data wipe. Fixed to compile/lint/test/build cleanly by Claude Code on 2026-08-22 (see `parallel-work-inventory.md`, `decisions.md`), but Meta field names/payload shapes were never fetched-and-confirmed against live docs, and `WHATSAPP_PROVIDER` is still `baileys` — none of it has run against a real request.
- M9 — Search and hardening (search, cursor pagination audit, structured logging sweep, retry/restart resilience) — not started
- Open decisions still flagged for the human (context.md §14): Phase B connection mode, shared-vs-per-agent numbers, data retention policy, Phase A→B history migration, final product name

## Important Decisions
- **Next.js (App Router)** — UI + internal API routes in one deployment
- **PostgreSQL + Prisma** — primary datastore; Prisma 7's driver-adapter model (`@prisma/adapter-pg`)
- **BullMQ on Redis** — all async work (ingestion, sends, media downloads, status updates) goes through queues, never inline
- **MinIO / S3-compatible object storage** — `@aws-sdk/client-s3`; media served through an authenticated app route, not a presigned URL (see `decisions.md`)
- **Baileys (unofficial) for Phase A, Meta Cloud API for Phase B** — a single `WhatsAppProvider` interface behind `src/providers/`, enforced by an ESLint boundary rule; product logic (24h window, templates, status progression) is built to Meta's rules from day one even though Baileys doesn't require them
- **Session-based auth** (iron-session), not SSO/OAuth — Tier 1 scope
- **Zod** at every input boundary; **Vitest** for tests (fast suite mocks nothing but the provider factory; a separate `test:integration` suite hits real Postgres/Redis)
- **Standalone Worker process** — mandatory, never serverless (holds Baileys sockets, runs all queue consumers)

---
_Update this file whenever a milestone starts/finishes or a major architectural decision is made — keep it short; the detail lives in the other root-level docs._
