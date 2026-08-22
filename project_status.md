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

## Currently Working On
- Getting a real WhatsApp number paired for live testing — boot-time channel-connect loop + `npm run activate-channel` CLI + QR-code-in-terminal pairing exist; not yet actually paired against a real phone (and the local Phase A data/session that would have supported this was wiped by the M10 work below, before it was identified).

## Pending
- **M7/M8/M10 — unplanned, partial, not formally done.** Gemini 3.1 Pro (via Antigravity, confirmed by the user) built real chunks of Templates, CRM, and Phase B/Meta Cloud API work out of order and uncommitted, including a destructive Phase A data wipe. Fixed to compile/lint/test/build cleanly by Claude Code on 2026-08-22 (see `parallel-work-inventory.md`, `decisions.md`), but none of it has been verified against its own "done when" criteria the way M1–M6 were — treat as "exists, no longer broken," not "done."
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
