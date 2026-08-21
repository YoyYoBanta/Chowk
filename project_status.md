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
- Getting a real WhatsApp number paired for live testing — added a boot-time channel-connect loop + `npm run activate-channel` CLI + QR-code-in-terminal pairing (no admin UI for this exists yet, that's M9). Not yet actually paired against a real phone.

## Pending
- M7 — Templates (sync, create/submit, picker with variable inputs, send)
- M8 — CRM layer (tags, notes, custom fields, assignment, quick replies)
- M9 — Search and hardening (search, cursor pagination audit, structured logging sweep, retry/restart resilience, real admin channel screen)
- M10 — Phase B migration (real Meta Cloud API adapter, webhook receiver, signature verification — do not start until M1–M9 are built *and used*)
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
