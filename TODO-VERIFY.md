# TODO-VERIFY — uncertain Meta WhatsApp Cloud API details flagged here instead of guessed

## M1 — Skeleton and tenancy

- **No reachable Postgres in this sandbox.** `npx prisma migrate dev` needs
  a live database connection and none is available here (no `psql`, no
  `docker`, port 5432 not listening). The migration SQL was instead
  generated via `npx prisma migrate diff --from-empty --to-schema=prisma/schema.prisma --script`,
  which diffs the schema without needing a live connection, and hand-placed
  into `prisma/migrations/20260821000000_m1_tenancy/migration.sql` +
  `prisma/migrations/migration_lock.toml` in the standard Prisma migration
  folder shape. **The maintainer must run `npx prisma migrate deploy` (or
  `migrate dev` for further schema iteration) against a real Postgres
  instance** — this has not been applied to any real database and needs
  human verification that it actually applies cleanly.
  ~~**VERIFIED 2026-08-21**: applied cleanly with `npx prisma migrate
  deploy` against a real PostgreSQL 17.5 instance (standalone Windows
  binaries, no Docker reachable in that verification environment either —
  see PROGRESS.md; `docker-compose.yml` now provides the Docker path for
  whenever it is available). Confirmed via `psql \dt` / `\d "User"` /
  `\dT+ "Role"` that `Organization`, `User`, and the `Role` enum land
  exactly as the schema describes, and re-verified by dropping and
  recreating the database and re-running `migrate deploy` from empty a
  second time (not order-dependent on leftover state). The migration file
  itself was not changed — it applied as-is, first try.~~
- **Cross-tenant isolation test runs against a mock, not real Postgres**,
  for the same reason (see `src/data/testing/fakePrisma.ts` for exactly what
  it does and doesn't prove — it validates the application-level `where`
  scoping in src/data/, not Postgres-level behavior). Once a real database
  is reachable, it would be worth adding a second version of this test that
  runs the same assertions through the real Prisma client, to also catch
  any drift between the fake's semantics and Postgres's.
  ~~**VERIFIED 2026-08-21**: added
  `src/data/tenancy-isolation.integration.test.ts`, running the identical
  assertions through the real `@/lib/prisma` client (no mocking) against
  the same real Postgres instance — 2/2 tests pass. Also added
  `src/lib/auth/login.integration.test.ts`, calling `loginWithPassword`
  against the seeded admin user's real documented dev password
  (`chowk-dev-password`) with a real database round trip; only
  `next/headers`'s `cookies()` is stubbed (with a plain in-memory jar,
  same narrow workaround `session.test.ts`/`login.test.ts` already use)
  because it throws outside a real Next.js request — iron-session, bcrypt,
  Prisma, and the database are all real. 2/2 pass, including the session
  round-trip (`getCurrentSession()` returns the real seeded user's
  `userId`/`organizationId`/`role`). Both integration files are excluded
  from the default `npm test` / `vitest run` (see `vitest.config.ts`'s
  `exclude` and the new `vitest.integration.config.ts`) and run instead via
  `npm run test:integration` — the fast mocked suite (18/18) is unaffected
  and still requires no database.~~
- **The M1 migration file was left completely untouched** — it applied
  cleanly on the first try against real Postgres, so there was nothing to
  fix here. Noted only so it's clear this was checked, not assumed.
- **Prisma 7 breaking change discovered during this milestone**: the
  `datasource { url = env(...) }` form used in Phase 0's schema is no
  longer valid — Prisma 7 requires the connection string to come from a
  driver adapter (`@prisma/adapter-pg`, added this milestone) for the
  runtime client, and from `prisma.config.ts` for the CLI. Confirmed
  against the Prisma 7 docs; flagging here in case the maintainer's own
  Prisma familiarity predates this change.
- Login is email + password only (per the M1 spec), with no organization
  selector in the UI — see the exception documented in
  `src/data/users.ts` (`findCandidateUsersByEmailForLogin`) for how this
  was reconciled with the "organizationId first, always" data-layer rule.
  Worth a deliberate look before M2: is a tenant selector (subdomain,
  slug, or explicit field) wanted before this scales past a couple of
  organizations sharing an email address?

## M2 — Provider adapter + ingestion (Phase A)

- **No dedicated WhatsApp test number available.** This is the big one,
  flagged exactly as the milestone brief asked. `src/providers/baileys/adapter.ts`'s
  `connect()`/`disconnect()`/`getConnectionState()`/the real
  `messages.upsert`/`messaging-history.set`/`connection.update` event
  wiring are code-complete against the real `@whiskeysockets/baileys`
  package, but have never been run against an actual WhatsApp session —
  there is nothing to pair a QR code with. **This needs to happen once the
  maintainer has a dedicated test SIM** (context.md §2: "Use a dedicated
  test number in Phase A. Never a number carrying real partner or customer
  relationships"). What COULD be verified instead, and was: the entire
  pipeline below the transport, for real — real Postgres, real Redis, real
  BullMQ queue, real dedupe/upsert logic — by hand-constructing
  `NormalizedInboundEvent` objects (as a real Baileys socket would produce
  them) and pushing them through the actual `ingest-inbound` queue into the
  actual consumer (`src/worker/consumers/ingest-inbound.consumer.integration.test.ts`
  and `src/worker/ingest-inbound-pipeline.integration.test.ts`). See
  PROGRESS.md's M2 section for the full list of what that proved.

- **Package choice: `@whiskeysockets/baileys`, pinned to `6.7.24`, not the
  registry's own `latest` dist-tag.** Checked the npm registry directly
  (not training data) rather than assuming a package name/version:
  - Two packages track the same codebase in lockstep — the scoped
    `@whiskeysockets/baileys` and the unscoped `baileys` — both published
    by the `WhiskeySockets/Baileys` GitHub org. Went with the scoped name:
    its `repository` field in the registry unambiguously points at
    `github.com/WhiskeySockets/Baileys`, whereas a direct registry fetch of
    the unscoped `baileys` package returned a `repository` field pointing
    at an unrelated fork (`amiruldev20/baileys`) despite an identical
    version string — inconclusive enough (possibly a metadata quirk,
    possibly a squat) that the unambiguous scoped name was the safer call.
  - The registry's `latest` dist-tag currently points at `7.0.0-rc14` (a
    pre-release of an in-progress rewrite; `dist-tags` also carries a
    `legacy` tag pinned at `6.7.24`, the last pre-7.x stable release, which
    is what a plain `npm install @whiskeysockets/baileys@6.7.24` — or
    `legacy` — installs). **`7.0.0-rc14` was tried first** (matching "use
    the registry's own current tag") **but its dependency
    `whatsapp-rust-bridge` (a native Rust/WASM bridge new to the 7.x line)
    failed to resolve at all** under this project's module
    resolution — `ERR_PACKAGE_PATH_NOT_EXPORTED` on a bare import, in both
    `tsx` and Vitest/Vite. This is not a Postgres/Redis/network problem;
    the package fundamentally would not load in this environment. Given a
    milestone whose entire adapter is "code-complete but unverified live"
    already, shipping a version that doesn't even import cleanly would
    have been worse than picking the registry's own designated stable
    fallback. Switched to `6.7.24` (the `legacy` dist-tag's version, itself
    patched against the zero-day spoofing advisory
    [GHSA-qvv5-jq5g-4cgg](https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg)
    — anything below `6.7.22` is explicitly vulnerable) — this imports
    cleanly and every test in this milestone (`normalize.test.ts`,
    `factory.test.ts`, both ingest-inbound integration suites) runs against
    it for real. **Revisit this pin once 7.x leaves release-candidate
    status and/or the maintainer wants to retest the rust-bridge import
    issue** — it may simply be a packaging bug in an early RC that gets
    fixed before 7.0.0 final ships.

- **Baileys event/type shapes: what was read directly from the package's
  own generated `.d.ts` files vs. inferred.** Per context.md rule 1's spirit
  (don't trust training data for third-party API specifics — that rule is
  written about Meta's Cloud API, but the same caution applied here since
  this ecosystem's package names/APIs are noted as having shifted before):
  - **Read directly from `node_modules/@whiskeysockets/baileys/lib/Types/*.d.ts`**
    (real, current, for the installed `6.7.24`): `BaileysEventMap`'s
    `messages.upsert` / `messaging-history.set` / `connection.update` /
    `creds.update` shapes; `AuthenticationState`/`AuthenticationCreds`/
    `SignalKeyStore`/`SignalDataTypeMap` (the DB-backed auth-state
    contract); `WAMessage`/`WAMessageKey`; `DisconnectReason`; the
    `getContentType`/`toNumber`/`BufferJSON` utility signatures; and
    `UserFacingSocketConfig = Partial<SocketConfig> & { auth: AuthenticationState }`
    (confirming `makeWASocket({ auth: state })` needs nothing else
    required).
  - **Inferred, not verified against a live socket**: the exact runtime
    shape of `lastDisconnect.error` as a genuine `@hapi/boom` Boom object
    with an `.output.statusCode` — this is standard, well-documented Boom
    behavior and Baileys' own examples rely on it, but it's never been
    observed firing from a real disconnect here. Duck-typed rather than
    importing `@hapi/boom`'s type directly (see `adapter.ts`'s comment) —
    partly to avoid an undeclared direct dependency on Baileys' own
    transitive package, partly because the shape only needs to be "close
    enough" for a `?.` chain to fail safely either way.
  - **Media proto field names** (`mimetype`, `fileSha256`, `fileLength`,
    `fileName`, `directPath`, `url`, `caption` on `imageMessage` etc. —
    `src/providers/baileys/normalize.ts`'s `mediaRefFrom`) come from
    `Types/Message.d.ts`'s `DownloadableMessage` type plus long-stable,
    widely-documented WhatsApp protobuf field names — not guessed, but also
    not exercised against a real downloaded file, since the actual media
    download/storage pipeline is explicitly M6's job, not M2's.

- **ESLint provider-boundary rule: enforced slightly stricter than
  context.md rule 0's exact sentence, with one documented, tested
  exception.** Rule 0 says "no file outside `src/providers/` may import a
  Baileys symbol"; the concrete `no-restricted-imports` rule added in
  `eslint.config.mjs` instead bans reaching into `src/providers/baileys/**`
  (or the raw package) from **any** file, `src/providers/factory.ts`
  included — because architecture.md §5 rule 2 ("One factory, one call
  site... never `new BaileysAdapter()` directly") requires factory.ts to be
  the *only* place that constructs the adapter, and a rule that let every
  file under `src/providers/` reach into `baileys/` wouldn't enforce that.
  `factory.ts` gets a narrow, separate override in `eslint.config.mjs` that
  permits *only* `import { baileysAdapter } from "./baileys/adapter"` —
  it still cannot import the raw `@whiskeysockets/baileys` package
  directly, verified by temporarily injecting that exact import and
  confirming ESLint still flags it (then reverting). Also manually
  confirmed the general rule fires for a deliberate violation from
  `src/services/` before removing the test file — see PROGRESS.md's M2
  section.

- **`Message.rawPayload` — one column added beyond context.md §7.4's literal
  list.** The milestone's own acceptance criteria require proving an
  `UNSUPPORTED`-typed message preserves its original payload, and
  `NormalizedInboundEvent.raw` ("always preserve the original payload")
  has to be stored somewhere durable for that to be checkable later — the
  literal schema block in context.md/the task brief has no such column.
  Added `rawPayload Json?` to `Message` (see the doc comment in
  `prisma/schema.prisma` right above it) rather than silently reusing
  `templatePayload` or `interactivePayload` for an unrelated purpose.

- **`BaileysSessionData` / `BaileysSignalKey` — the concrete storage shape
  behind `Channel.sessionRef`**, since context.md only specifies that field
  as "a pointer to stored Baileys session state" without saying to what.
  Two tables (creds vs. signal keys), reasoning in `prisma/schema.prisma`'s
  comment above them and `session-store.ts`'s doc comment. This is
  genuinely new design, not lifted from an official Baileys example (their
  own `useMultiFileAuthState` — which this replaces — explicitly disclaims
  itself as unsuitable for anything beyond a local dev/bot use case and
  recommends "writing an auth state for use with a proper SQL or No-SQL
  DB" without specifying one).
  *Note on wiring:* During Phase A live test path setup, it was discovered
  that the DB session store from M2 was briefly bypassed when `BAILEYS_SESSION_DIR`
  was scaffolded, routing credentials to local disk instead of Postgres.
  This was fixed by establishing PostgreSQL as the single, authoritative
  session store across `scripts/pair.ts`, `scripts/smoke.ts`, and `src/worker/index.ts`,
  ensuring multi-tenant channel credential isolation and container durability.

- **`IngestInboundJobData` wraps `NormalizedInboundEvent` with
  `organizationId`/`provider` rather than the queue carrying the bare event.**
  This was necessary to keep `src/data/*.ts` genuinely exception-free
  (the milestone brief was explicit: "No exceptions this time... there's
  no equivalent reason to break the rule here" for channels/contacts/
  conversations/messages). Since `NormalizedInboundEvent` (context.md
  §8.0.2, unmodified) carries only `channelId`, something has to supply
  `organizationId` before any org-scoped data-layer call — doing that by
  looking it up from `channelId` alone inside the consumer would have been
  exactly the kind of unscoped lookup the brief said not to add. Instead,
  the provider adapter (which already holds the full `Channel` row,
  `organizationId` included, from its own `connect(channel)` call) supplies
  it at enqueue time. See `src/queue/queues.ts`'s doc comment.

- **BullMQ + this environment's Redis**: the standalone Windows Redis build
  reused from M1's verification (tporadowski's 5.0.14.1) logs "It is highly
  recommended to use a minimum Redis version of 6.2.0" on every BullMQ
  Worker start. Functionally fine here — the real end-to-end queue test
  (`ingest-inbound-pipeline.integration.test.ts`) passes against it — but
  worth using a current Redis (the `docker-compose.yml` `redis:7-alpine`
  service, whenever Docker is reachable) for anything beyond local dev.

- **`src/worker/index.ts` does not auto-connect any channel's Baileys
  socket on boot.** Deliberate, not an oversight — see the doc comment at
  the top of that file. With no real test number, having the worker
  eagerly call `connect()` for the seeded `DISCONNECTED` channel on every
  boot would just spin on reconnect attempts against nothing. Wiring that
  back in once a real channel exists is a one-line loop over `listChannelsInOrg`-style
  data (across all orgs, since the worker is one process for the whole
  platform) calling `getWhatsAppProvider().connect(channel)`.

- **Baileys adapter's send/media/template methods are stubs, matching
  cloud-api's style, not full Meta-parity simulations.** context.md §8.0.4
  describes window-check/template-simulation/rate-limit behavior the
  Baileys adapter should eventually simulate — none of that is built yet.
  This matches the M2 task list's own explicit non-goals ("No outbound
  send implementation beyond the stub interface methods (M4)", "no
  templates (M7)"), so it's a scope read, not a gap discovered late — but
  flagging it here too since context.md §8.0.4 could be read as wanting it
  sooner.

## M3 — Read-only inbox + structured logging

**The live-number gap, as it applies to this milestone.** Same root cause
as M2's: there is still no dedicated WhatsApp test number, so the literal
"a message sent from a phone appears in the open browser thread within two
seconds" done-criterion (context.md §11, implementation-plan.md M3) cannot
be checked against a real phone. Everything below the phone has been
verified for real instead:

- A synthetic `NormalizedInboundEvent` pushed onto the real `ingest-inbound`
  BullMQ queue → consumed by the real `processIngestInboundJob` → written
  to real Postgres → published over real Redis pub/sub → received by a
  real HTTP SSE client within seconds
  (`src/worker/realtime-sse.integration.test.ts`).
- Cross-tenant isolation proven at three separate layers, not just one:
  the data layer (`src/data/conversations-messages-tenancy.integration.test.ts`),
  the API route layer (`src/app/api/conversations/tenancy.integration.test.ts`),
  and the realtime/SSE layer (the second test in
  `realtime-sse.integration.test.ts` — two real SSE connections, two real
  organizations, one real publish, and org B's connection never sees it).
- The full UI was also manually smoke-tested against a real running
  `next dev` server (real Postgres-backed seed data, a hand-minted but
  genuinely-sealed session cookie via `sealSessionCookie`, real `curl`
  requests) — the conversation list, thread view (including TEXT/IMAGE/
  LOCATION/UNSUPPORTED rendering and inbound/outbound alignment), contact
  panel, `GET /api/conversations`, and the SSE endpoint's `: connected`
  handshake all confirmed working end to end, not just under `vitest`.

Once a dedicated test number exists: run `npm run worker` with an ACTIVE
Baileys channel, have a browser tab open on `/dashboard/conversations/:id`
for that channel's conversation, send a real WhatsApp message from a
personal phone, and confirm it appears in the thread without a manual
refresh, within a couple of seconds. Everything upstream of "does a real
socket event reach this pipeline" is already proven; that step alone is
what stays deferred.

**Real judgment calls made building this milestone:**

- **`getSessionFromRequest` (src/lib/auth/session.ts) reads the session
  off the raw `Request`'s `Cookie` header via iron-session's
  `getIronSession(request, response, options)` overload, instead of
  reusing `getCurrentSession()`'s `next/headers` `cookies()` path.**
  `next/headers`' `cookies()`/`headers()` only work inside the
  AsyncLocalStorage request-scope Next's own server sets up around a real
  request — reusing it in a Route Handler would have made the handler
  impossible to call directly (e.g. from a test, or from the SSE bridge
  server below) without also standing up a full `next dev`/`next start`
  process. The `getIronSession(request, response, ...)` overload instead
  parses the `Cookie` header straight off the `Request` object with no
  framework-internal context required — same production behavior, but
  testable by direct invocation too. `requireApiSession` (src/lib/auth/
  guard.ts) is the Route Handler equivalent of `requireSession()`/
  `requireRole()`, returning a 401 JSON response instead of redirecting
  (redirecting an API/fetch/EventSource caller to `/login` makes no sense).
- **`sealSessionCookie` (src/lib/auth/session.ts) is test-support code
  living in a production auth file.** It mints a validly-sealed session
  cookie value without driving the actual login form/server action —
  needed because the milestone's own required tests (API tenancy, SSE
  tenancy/delivery) need to authenticate as a specific, disposable
  organization/session without a browser. Kept as a clearly-documented,
  narrow addition (one function, doc comment explicit that application
  code never calls it) rather than building a separate test-auth harness
  file, since it's a one-line wrapper around iron-session's own `sealData`
  using the exact same `sessionOptions` the rest of the module already
  defines.
- **The SSE integration test uses a thin Node `http` bridge server, not a
  real `next dev`/`next start` child process.** The milestone brief asks
  for "an actual HTTP request... not a mocked one" reaching `/api/events`.
  A full Next server (port allocation, readiness polling, a real boot) is
  heavier and more failure-prone to drive from inside a Vitest process
  than the alternative chosen here: a minimal `http.createServer` that,
  per request, builds a real `NextRequest` from the incoming socket and
  calls the actual exported `GET` function from
  `src/app/api/events/route.ts` directly, then streams its real
  `ReadableStream` response body back over a real TCP socket via genuine
  `fetch()` on the test side. Everything below the routing/dev-server
  plumbing — session auth, Redis subscribe, SSE framing, the full queue →
  consumer → DB → publish pipeline — is the unmodified, real application
  code path; only Next's own request-routing layer is bypassed. Judged an
  acceptable trade given the milestone's actual concern (does the realtime
  pipeline work end to end over a real socket, not "does Next's router
  dispatch to this file").
- **Subscribe-before-"connected" ordering in `src/app/api/events/route.ts`
  is a genuine correctness fix, not just a test convenience.** Redis
  pub/sub has no replay/persistence — a publish that lands before a
  subscriber's `SUBSCRIBE` command has actually registered with Redis is
  simply missed by that connection, permanently. The route now awaits
  `subscribeToOrgEvents` before emitting the `: connected` SSE comment, so
  "connection observed as open" and "this connection will now see events
  published from this point forward" are the same guarantee. This closes
  a real (if narrow — sub-millisecond in practice, since Redis is local)
  race window that existed in an earlier draft of this route, caught by
  writing the SSE delivery test deterministically rather than with a fixed
  sleep.
- **Cursor pagination's cursor shape is a plain base64url-encoded JSON
  object (`{ <sortField>: isoString, id }`), not a signed/opaque token.**
  context.md §9 only requires cursor-based pagination, not tamper-proofing
  the cursor itself — a forged cursor can only ever change which page of
  the CALLER'S OWN organization's rows comes back (every list query is
  still `organizationId`-scoped independently of the cursor), so there is
  no tenancy or authorization value in signing it. Kept simple
  (`src/lib/validation/pagination.ts`) rather than adding HMAC signing for
  a value that carries no trust decision.
- **The logger's `LogFields` is a closed interface with no index
  signature, specifically so it has no `body`/`content`/`text` property**
  (context.md §12: "No message bodies in application logs"). This makes
  the common accidental case — spreading a `Message` row into a log call's
  fields object — a TypeScript excess-property-check error at the call
  site, proven directly in `src/lib/logging/logger.test.ts` via a
  `// @ts-expect-error` assertion that `tsc --noEmit` itself checks stays
  accurate. It does not stop a value typed `any`/`unknown` from being cast
  through, which is a real, acknowledged limit of a compile-time-only
  guarantee — there is no runtime scrubbing/redaction layer here, by
  design (the milestone brief asked for something "boring", not a full
  redaction pipeline).
- **`correlationId` in the ingest-inbound consumer is generated at the top
  of `processIngestInboundJob` (queue-consumption time), not at the true
  origin of the inbound event** (the Baileys socket's `messages.upsert`
  handler in `src/providers/baileys/adapter.ts`, where the job is actually
  enqueued). Threading a correlation id through that enqueue call would
  have meant modifying a file under `src/providers/` beyond what this
  milestone's brief permits ("Do not modify `src/providers/`... beyond
  what's already there"). The id still covers every log line this
  milestone's own new code adds for one message's processing — dedupe
  check → contact/conversation upsert → persist → realtime publish — which
  is the traceable unit of work this milestone is actually responsible
  for. Revisit this once a milestone that's allowed to touch the provider
  adapters threads a correlation id all the way from the socket event
  itself.
- **The realtime publisher (`src/services/realtime/publish.ts`) uses its
  own dedicated ioredis connection, separate from both the BullMQ queue's
  shared connection (`src/queue/connection.ts`) and each SSE connection's
  own per-client subscriber.** This isn't optional: once an ioredis
  connection issues `SUBSCRIBE`, the Redis protocol restricts it to
  further pub/sub commands only — it can never again be used to `PUBLISH`
  or run a normal command. A single subscriber connection per SSE client
  (rather than one pattern-subscribed connection shared across every
  client) was chosen specifically so a cross-tenant leak is structurally
  impossible (each connection only ever subscribes to its own org's exact
  channel name) rather than merely policy-enforced by a filter that could
  have a bug.
- **No filters (status/assignedTo/channelId/tag/search) on
  `GET /api/conversations`, no computed 24h-window state on the detail
  route, no assignment/avatar on the list UI, no tags/notes/custom-fields
  on the contact panel.** All explicitly deferred per the milestone brief
  itself (M8/M9 for filters/tags/assignment, M5 for the window) — noted
  here only so it's clear these are scope decisions carried out exactly as
  specified, not gaps discovered late.
- **`prisma/seed.ts`'s new `seedM3Inbox()` builds its demo data through the
  real data-access layer calls (`upsertContact` →
  `upsertConversationForInbound` → `createMessage`)**, the same functions
  the real ingest-inbound consumer calls, rather than raw
  `prisma.*.create()` — so `unreadCount`/`lastMessageAt`/`lastInboundAt`
  end up in exactly the state real ingestion would produce, and a human
  running `npm run dev` right after `npm run seed` sees a populated,
  realistic inbox (including one conversation exercising IMAGE/LOCATION/
  UNSUPPORTED placeholders) without needing a live WhatsApp number at all.
  Idempotent only for its own concern (skips an org that already has any
  conversation), matching `seedM2Channels()`'s existing idiom — M1's own
  org/user seeding is still not idempotent, unchanged from M2's note above.

## M4 — Outbound text

**The live-number gap, as it applies to this milestone.** Same root cause
as M2/M3's: there is still no dedicated WhatsApp test number, so the
literal "an agent replies from the UI, the message arrives on the phone,
and the tick indicator progresses to read" done-criterion (context.md §11,
implementation-plan.md M4) cannot be checked against a real phone or a real
WhatsApp delivery receipt. Everything else in the pipeline has been
verified for real instead:

- The send pipeline end to end against real Postgres + real BullMQ, with
  only `src/providers/factory.ts`'s `getWhatsAppProvider()` mocked to a
  test-double provider (never Prisma, the queue, or the consumer logic
  itself) — `src/worker/consumers/send-message.consumer.integration.test.ts`:
  success (→ `SENT` + `providerMessageId` captured), terminal failure (→
  `FAILED` + `errorCode`/`errorMessage`, resolves without throwing so
  BullMQ never retries it), retryable failure (→ throws, message stays
  `PENDING`, never prematurely `FAILED`), and the crash-recovery ordering
  proof itself (a `PENDING` row exists immediately after
  `sendTextMessage()` returns, and survives — still `PENDING`, not lost —
  even when the actual provider call is made to throw outright).
- Forward-only status progression against real Postgres, fed synthetic
  `NormalizedStatusEvent`s in deliberately out-of-order sequences through
  the real `processStatusUpdateJob` —
  `src/worker/consumers/status-update.consumer.integration.test.ts`: the
  normal forward path (`SENT → DELIVERED → READ`), a stale `SENT` arriving
  after `READ` is ignored (row stays `READ`), a `FAILED` arriving after
  `SENT` applies and is then itself terminal (nothing moves past it), an
  unknown `providerMessageId` is logged and dropped without throwing, and
  the `provider` scoping on the lookup itself (a matching id under a
  different `provider` string is correctly not found).
- The pure ranking function itself, in isolation, with zero DB —
  `src/lib/messages/status-progression.test.ts` — this is context.md §13's
  named correctness-bug hotspot, exercised directly against the ranking
  logic, not just indirectly through the integration tests above.
- The real Baileys adapter's graceful-failure path (not the
  factory-mocked one) — `src/providers/baileys/adapter.test.ts`: calling
  the actual `sendText()`/`markAsRead()` against a channel that was never
  `connect()`-ed resolves cleanly (a well-formed retryable `SendResult` /
  `undefined`, respectively) rather than throwing — the "write the failure
  path first" rule (context.md rule 6), exercised against "no session"
  since no network/protocol error is reachable without a live socket.
- The real Baileys `messages.update` → `NormalizedStatusEvent` mapping,
  using the package's own real `WAMessageStatus` enum values as fixtures —
  `src/providers/baileys/normalize.test.ts`.

Once a dedicated test number exists: run `npm run worker` with an ACTIVE
Baileys channel, reply from `/dashboard/conversations/:id`'s composer, and
confirm the message arrives on the paired phone and the tick indicator in
the UI progresses PENDING → SENT → DELIVERED → READ as the phone's own
receipts come back. Everything upstream of "does a real socket actually
send/receive" is already proven for real; that step alone stays deferred.

**Real Baileys API shapes used, and how they were confirmed (not guessed,
per context.md rule 1/2):**

- `sock.sendMessage(jid: string, content: AnyMessageContent, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | undefined>`
  — read directly from
  `node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.d.ts`.
  `{ text: string }` (used for our plain-text send) is confirmed as a real
  member of `AnyRegularMessageContent` in
  `lib/Types/Message.d.ts`. The `undefined` branch of the return type is
  handled explicitly (`NO_MESSAGE_ID_RETURNED`, retryable) rather than
  assumed away.
- `sock.readMessages(keys: WAMessageKey[]): Promise<void>` — read directly
  from `node_modules/@whiskeysockets/baileys/lib/Socket/chats.d.ts`.
- `messages.update: WAMessageUpdate[]` event, `WAMessageUpdate = { update: Partial<WAMessage>; key: proto.IMessageKey }`
  — read directly from `lib/Types/Events.d.ts` / `lib/Types/Message.d.ts`.
- The ack-status enum itself — `ERROR = 0, PENDING = 1, SERVER_ACK = 2,
  DELIVERY_ACK = 3, READ = 4, PLAYED = 5` — read directly from the
  generated `WAProto/index.d.ts`'s `proto.WebMessageInfo.Status`, accessed
  in our own code via the package's own top-level alias `WAMessageStatus`
  (`export declare const WAMessageStatus: typeof proto.WebMessageInfo.Status`
  in `lib/Types/Message.d.ts`, re-exported from the package root) rather
  than reaching into the `proto` namespace directly.

None of the above were inferred from training data or guessed — each was
read from the installed package's own `.d.ts` files (version `6.7.24`, same
pinned version as M2) before being used.

**Judgment calls made building this milestone, flagged rather than
silently decided:**

- **`sendText()`'s "no active session for this channel" failure is
  classified `retryable: true`, not terminal.** There is no live WhatsApp
  session to observe, so this is a genuine judgment call rather than an
  observed fact: a channel with no live socket may simply be mid-reconnect
  (the adapter already retries its own socket connection with backoff on
  an unexpected disconnect — see `handleConnectionUpdate`), so a later
  retry has a real chance of succeeding. The same `retryable: true`
  default is used for any thrown error from `sock.sendMessage()` itself
  (network failure, a malformed jid, etc.) rather than guessing which
  thrown errors are "really" terminal — context.md rule 2 ("never invent
  an error code") argues for the safer default here, since BullMQ's own
  bounded retry/backoff (`src/queue/queues.ts`, `attempts: 5`) still
  resolves to a `FAILED` row via `markSendMessageJobExhausted` once
  attempts run out, rather than either infinite-retrying or wrongly
  giving up on the first attempt. Revisit this once a live session exists
  to actually observe which failures are transient versus permanent.
- **Baileys' `messages.update` carries only a numeric ack status, not a
  structured per-message failure reason the way Meta's Cloud API error
  codes do (context.md §4.7).** A `FAILED` status normalized from Baileys'
  `ERROR` ack therefore always carries the same generic
  `errorCode: "BAILEYS_SEND_ERROR"` / a generic human-readable message —
  this is an honest representation of what Baileys actually tells us, not
  a stand-in for a real code we simply haven't looked up yet.
- **`markAsRead(channelId, providerMessageId)`'s interface signature
  (fixed at M2, context.md §8.0.1) doesn't carry the `remoteJid` Baileys'
  own `readMessages()` actually needs.** The Baileys adapter reconstructs
  it by looking the message up through the real, org-scoped data layer
  (`findMessageByProviderMessageId` → `getConversationWithContact` →
  `contact.waId`), using `organizationId` from the `Channel` row already
  held in the adapter's own `channels` map (populated by `connect()`) —
  the same precedent `handleIncomingMessage`'s `updateChannelStatus` call
  already established at M2. This keeps context.md rule 4 ("every database
  query scoped by organization_id, no exceptions") intact even though the
  public interface signature alone doesn't carry an organizationId.
- **The `status-update` queue's job payload threads `organizationId` and
  `provider` at the queue-payload level, exactly mirroring
  `IngestInboundJobData`'s M2 precedent** (`src/queue/queues.ts`), rather
  than inventing a new pattern — both are supplied by the Baileys adapter
  from the `Channel` row it already holds from `connect()`, so
  `src/data/messages.ts`'s `findMessageByProviderAndProviderMessageId` stays
  organizationId-first with zero exceptions, just like every other
  data-access function.
- **`send-message.ts` stamps the outbound `Message.provider` field with
  `getWhatsAppProvider().name`** (the currently-configured transport)
  rather than looking up the conversation's `Channel.provider` field. In
  practice these should always agree (one transport is active platform-wide
  per the `WHATSAPP_PROVIDER` env var), but nothing currently enforces
  that a `Channel` row's own `provider` column can't drift from the
  globally active one. Using `.name` avoids an extra query in the hot
  send path and matches "which adapter is actually about to attempt this
  send" more directly than a stored column would; flagged here as a
  reasonable default worth reconsidering if channel-level provider
  overrides are ever introduced.
- **A retryable send failure or an uncaught throw from the provider is
  treated identically by `processSendMessageJob`** — both simply propagate
  as a thrown error, handing the retry decision to BullMQ's own
  `attempts`/`backoff` config. No attempt is made to distinguish "the
  adapter deliberately told us this is retryable" from "the adapter's own
  code threw an exception we didn't expect" — both are equally
  "something went wrong that a retry might fix," and both are equally
  covered by the bounded-retry safety net
  (`markSendMessageJobExhausted`) once attempts run out.
- **No dedicated API-route-level integration test for `POST
  /api/conversations/:id/messages` or `POST /api/conversations/:id/read`**
  beyond the service-layer tests above and the routes' own close
  resemblance to M3's already-tested route conventions (`requireApiSession`,
  correlation id, tenancy 404, logger request start/end). The substantive
  logic (PENDING-before-enqueue ordering, retryable/terminal branching,
  forward-only status application) lives in the services/consumers and is
  covered there for real; the routes themselves are thin, structurally
  identical wiring to the already-integration-tested M3 routes. Worth
  adding a dedicated route-level test if these routes grow more logic of
  their own in a later milestone.

**Post-implementation verification fix (2026-08-21) — `npm run build` failure,
unrelated to M4's own application logic:**

- `npm run build` (Turbopack) failed with `Module not found: Can't resolve
  'jimp'`, tracing through
  `@whiskeysockets/baileys/lib/Utils/messages-media.js` →
  `src/providers/baileys/adapter.ts` → `src/providers/factory.ts` →
  `src/services/messages/send-message.ts` → the new
  `POST /api/conversations/:id/messages` route. Root cause, confirmed by
  reading the installed package's own `package.json`: `jimp` and `sharp`
  are `peerDependencies` of `@whiskeysockets/baileys@6.7.24` (`jimp` marked
  `optional: true` in `peerDependenciesMeta`; `sharp` is not marked optional
  there, an apparent upstream metadata inconsistency, but is used
  identically) — `lib/Utils/messages-media.js` dynamically
  `import('jimp').catch(() => {})`/`import('sharp').catch(() => {})`s them
  purely for outbound-image thumbnail generation, a feature this project
  doesn't use at all (media send is M6's job, out of scope here) and
  neither package is installed. Baileys's own runtime code already
  degrades gracefully when both are absent (the `.catch()`); the failure
  was Turbopack's static bundler trying to eagerly resolve those dynamic
  imports at build time rather than deferring to a runtime `require()`.
  **Fix**: added `serverExternalPackages: ["@whiskeysockets/baileys"]` to
  `next.config.ts` (the stable, non-experimental key — confirmed against
  the installed Next 16.3.1's own `node_modules/next/dist/server/config-shared.d.ts`,
  which also lists a deprecated pre-16 alias) — this tells Next to
  `require()` the whole package at runtime for server code instead of
  bundling it, which is exactly the code path where baileys's own
  try/catch already handles the missing-optional-dependency case. No
  application code changed, no new dependency added, and no `src/providers/`
  file touched — this is purely a bundler-configuration correction. Full
  verification loop re-run clean after this change (`tsc`, `vitest`,
  `test:integration`, `build`, `eslint` all green — see PROGRESS.md's M4
  section for the exact counts).

## M5 — The 24-hour window

Genuinely small this time — this milestone's own brief is correct that it's
mostly pure date-math and fully exercisable without a live number. Two
judgment calls worth recording (neither is a live-phone gap):

- **`src/providers/baileys/simulate-window.ts`'s `checkWindowOpenForSend`
  fails OPEN (`null` — proceed with the send) when there's no known
  `Contact`/`Conversation` for the `(channelId, to)` pair at all**, rather
  than treating "we can't determine the window state" as itself a
  rejection. Reasoning: in this system a send always originates from an
  existing conversationId at the service layer (which independently
  enforces the window against that same conversation's own row), so the
  adapter-layer check only ever has "nothing to check against" for a
  hypothetical future caller reaching `sendText`/`sendMedia` with a
  brand-new `to` that has no conversation history yet — there's no
  `lastInboundAt` to compare against, so nothing to enforce, and refusing
  to send here would just add friction for the service layer having
  already made the real decision. Worth revisiting if the adapter is ever
  called somewhere that doesn't guarantee this.
- **`sendText()`/`sendMedia()` check the window BEFORE the "is there a live
  socket at all" check**, so a channel with both a closed window and no
  live socket returns `WINDOW_CLOSED` (terminal) rather than
  `NO_ACTIVE_SESSION` (retryable). This was a deliberate ordering choice
  (a closed window is definitive, known-terminal information; "no socket
  yet" is a transient state that might resolve on its own) but was never
  observable against a real mixed failure mode (window closed AND
  reconnecting) since there's no live session yet — worth confirming this
  priority is still the right one once real connection-flakiness patterns
  are observed.

No other uncertainty flagged — the window-math boundary cases
(`src/services/window.ts`) are pure, fully unit-tested, and the send-
pipeline's structured-rejection-with-zero-rows-created behavior was
verified for real against Postgres (`src/services/messages/
send-message.window.integration.test.ts`), including a real HTTP request
through the exported route handler — see PROGRESS.md's M5 section for the
full list of what was actually run and the real output it produced.

## M6 — Media

**The live-number gap, as it applies to this milestone**, ~~now compounded by
a second, new gap — no reachable object storage either~~.

**VERIFIED 2026-08-21 (post-merge verification pass)**: the object-storage
half of this gap is now closed. A real MinIO server was started for the
first time in this repo's history (standalone Windows `minio.exe`/`mc.exe`
binaries — no Docker reachable in this verification environment either,
same as every prior milestone's own infra story) and the `chowk` bucket was
created by hand via `mc mb local/chowk` exactly as `docker-compose.yml`'s
comment prescribes. `src/lib/storage/object-store.ts`'s three exported
functions were exercised directly against it, outside the (still-mocked,
deliberately — see below) integration suite: a real `PutObjectCommand`
followed by a real `GetObjectCommand`, confirming
`Body.transformToByteArray()` and `Body.transformToWebStream()` are real,
correctly-typed `SdkStreamMixin` methods (matching exactly what was
confirmed via `WebFetch` against `@smithy/types`' `.d.ts` at authoring
time — not a guess that turned out wrong) that round-trip the exact bytes
written, with the correct `ContentType`/`ContentLength` read back. This
closes the "confirmed via WebFetch but never exercised against a real S3
response object" gap noted below. **The live-WhatsApp-number half of the
gap remains open** — same root cause as every prior milestone's live-number
note: there is still no dedicated WhatsApp test number, so the literal "an
image sent from a phone renders in the thread" half of this milestone's
done-criterion cannot be checked against a real phone/session.

Two mocked seams were used in this milestone's integration tests, not one
— this is unchanged by the above; `src/lib/storage/object-store.ts` stays
mocked in the automated `test:integration` suite specifically (its real
behavior was instead confirmed by the standalone smoke test described
above, run separately, not by un-mocking it in the suite itself — the
mocking choice documented below is still the right call for a suite that
must stay fast and not depend on a running MinIO):

- `src/providers/factory.ts` — the same sanctioned seam every prior
  milestone's send-pipeline tests already use.
- `src/lib/storage/object-store.ts` (new) — mocked in
  `src/services/media/download-and-store.integration.test.ts`,
  `src/services/messages/send-message.media.integration.test.ts`, and
  `src/app/api/conversations/[id]/messages/media-route.integration.test.ts`.

What this proves for real (real Postgres, real BullMQ where the test says
so): the `Media` row's fields, `Message.mediaId` linking, the
download-media job's idempotency (a redelivered job never re-downloads or
creates a second row), the ingest-inbound consumer's same-tick enqueue of
a real `download-media` BullMQ job with the correct payload, the full
outbound media send pipeline through the real `send-message` consumer
(`uploadMedia()` then `sendMedia()`, in that order, with the right
`channelId`/`to`/`caption`), the 24h-window/file-validation rejections
creating zero rows, and a real HTTP `multipart/form-data` POST through the
actual exported route handler being parsed and dispatched correctly.
~~What is NOT verified for real: `putObject`/`getObjectBuffer`/
`getObjectStream` actually reaching a real S3-compatible bucket~~, ~~and
Baileys' `downloadContentFromMessage`/real `sock.sendMessage()` media calls
against an actual encrypted payload from a live session~~.

~~**VERIFIED 2026-08-21**: `putObject`/`getObjectBuffer`/`getObjectStream`
now confirmed against a real MinIO instance (see above) — this half of the
"not verified" note is closed. The Baileys half (`downloadContentFromMessage`/
real `sock.sendMessage()` media calls against an actual encrypted payload)
remains open — no live WhatsApp session exists to exercise it against, same
as every prior milestone's live-number gap.~~

**Once a dedicated test number exists** (the MinIO half of this instruction
is now done — see above, and skip straight to standing up a channel):
`docker compose up -d` (or the standalone-binary equivalent used in this
verification pass), create the `chowk` bucket (see `docker-compose.yml`'s
new comment above the `minio` service — MinIO does not auto-create
buckets), then run `npm run worker` with an ACTIVE Baileys channel: send a
real photo from a personal phone and confirm it renders in the thread
within a few seconds (not just a `Media` row appearing in a test
assertion); then send a photo from the UI's new attachment button and
confirm it arrives on the phone. Both should still render 24 hours later
(the milestone's literal second half of its done-criterion) — nothing
about this codebase's storage keys expire or get cleaned up, so this
should hold structurally, but has never been observed for real over a real
24-hour span.

**Real Baileys/AWS SDK API shapes used, and how they were confirmed (not
guessed, per context.md rule 1/2) — this milestone leaned on `WebFetch`
against the actual package source/docs since no `node_modules` exists in
this environment either (see Phase 0's PROGRESS.md note — every milestone
so far has been verified in a separate cloud agent environment, not
locally):**

- `downloadContentFromMessage({ mediaKey, directPath, url }, type, opts?): Promise<Transform>`
  — fetched directly from
  `https://unpkg.com/@whiskeysockets/baileys@6.7.24/lib/Utils/messages-media.d.ts`.
  `DownloadableMessage = { mediaKey?: Uint8Array | null; directPath?: string | null; url?: string | null }`
  and `WAMediaUpload = Buffer | { stream: Readable } | { url: URL | string }`
  — fetched from
  `https://raw.githubusercontent.com/WhiskeySockets/Baileys/v6.7.24/src/Types/Message.ts`.
  Confirmed exported from the package's public `Utils` barrel (`export *
  from './messages-media.js'`), the same barrel M2 already confirmed
  `getContentType`/`toNumber`/`WAMessageStatus` are re-exported from at the
  package root — `downloadContentFromMessage` is imported the identical
  way (`from "@whiskeysockets/baileys"` directly) in
  `src/providers/baileys/adapter.ts`.
- `AnyRegularMessageContent`'s image/video/audio/document/sticker members
  (`{ image: WAMediaUpload; caption?; jpegThumbnail? } & Mentionable & Contextable & WithDimensions`,
  etc.) — fetched from the same `src/Types/Message.ts` source file. `{
  mimetype?: string } & Editable` is added to every media variant (source
  quoted this directly), which is what makes setting `mimetype` on all four
  of `buildBaileysMediaContent`'s branches valid even though only the
  `document` variant's `mimetype` is REQUIRED (also confirmed directly).
  `AnyMessageContent` itself (the exported type name `sock.sendMessage()`'s
  second parameter actually uses) was separately confirmed present and
  exported in `Types/Message.d.ts` via the compiled `unpkg` `.d.ts`, not
  just the `.ts` source, to rule out a source/build drift.
- `MediaType = keyof typeof MEDIA_HKDF_KEY_MAPPING`, and the mapping's real
  keys (`audio, document, gif, image, ppic, product, ptt, sticker, video,
  thumbnail-*, md-msg-hist, md-app-state, product-catalog-image,
  payment-bg-image, ptv`) — fetched from
  `https://raw.githubusercontent.com/WhiskeySockets/Baileys/v6.7.24/src/Defaults/index.ts`.
  Confirms `baileysMediaTypeFromMime`'s four return values
  (`"image"|"video"|"audio"|"document"`) are all valid `MediaType` strings,
  and that `image`/`sticker` share the same HKDF label ("Image") — the
  basis for treating a `sticker` (`image/webp`) as `'image'` for decryption
  purposes rather than threading a separate sticker flag through
  `MediaReference`.
- `LocationMessage`'s real field names (`degreesLatitude`, `degreesLongitude`,
  both `optional double`, plus `name`/`address`/`url`) — fetched from
  `https://raw.githubusercontent.com/WhiskeySockets/Baileys/v6.7.24/WAProto/WAProto.proto`
  after two failed attempts against other candidate URLs (a 404 on
  `WAMessage.proto`, and a truncated/incomplete `unpkg` `.d.ts` fetch that
  didn't reach the relevant section) — not guessed as a fallback when the
  first fetch failed.
- `@smithy/types`' `SdkStreamMixin` interface
  (`transformToByteArray(): Promise<Uint8Array>`,
  `transformToString(encoding?): Promise<string>`,
  `transformToWebStream(): ReadableStream`) — fetched from
  `https://unpkg.com/@smithy/types/dist-types/serde.d.ts`, confirming
  `GetObjectCommandOutput.Body` really does carry these three methods
  before `src/lib/storage/object-store.ts` was written to rely on
  `transformToByteArray()`/`transformToWebStream()` rather than
  hand-rolling a Node-stream-to-buffer collector.
- Meta WhatsApp Cloud API media type/size limits
  (`src/services/media/limits.ts`) — fetched live from
  `https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media`
  on 2026-08-21 (image: jpeg/png, 5MB; video: mp4/3gpp, 16MB; audio:
  mpeg/aac/amr/mp4/ogg, 16MB; document: pdf/docx/xlsx/pptx/txt, 100MB;
  sticker: webp, 100KB static/500KB animated — sticker limits not currently
  enforced anywhere since Tier 1 has no outbound sticker send path,
  context.md §8.2). context.md §4.3/rule 1 both warn these numbers "changed
  materially" before and should not be trusted indefinitely — re-verify
  against live docs before a production deploy, not just once at
  implementation time.

**Judgment calls made building this milestone, flagged rather than silently
decided:**

- **`Message.mediaId` is deliberately left `null` at inbound-ingest time,
  not set to `event.media.id`.** The M2-era `ingest-inbound.consumer.ts`
  code actually had a real, if latent, bug here — it stored the provider's
  own transient media reference (a Baileys `directPath`/Meta media id) into
  `mediaId` as if it were a `Media.id` foreign key, which it never was (no
  `Media` model existed until this milestone). Fixed as part of this
  milestone's own work, not a separate bugfix, since the bug and the
  feature are the same code path (see `src/worker/consumers/
  ingest-inbound.consumer.ts`'s doc comment on the `createMessage` call).
- **Outbound media re-uploads to the provider on every send attempt,
  including a BullMQ retry — no provider-side media id is cached and
  reused.** `Media.metaMediaId` exists in the schema (context.md §7.5) and
  was considered for exactly this caching purpose, but rejected for the
  reason spelled out in `src/services/media/upload-outbound.ts`'s doc
  comment on `uploadStoredMediaToProvider`: Baileys' own `uploadMedia()`
  only keeps the buffer in an adapter-local in-memory `Map`
  (`outboundMediaCache`), which a Worker restart between "upload" and a
  later retry's "send" would silently empty — caching and reusing an id
  across that gap would produce a permanently-broken reference instead of
  a harmless one. Always re-uploading fresh sidesteps the trap entirely, at
  the cost of a real but minor inefficiency once Phase B (M10) makes
  `uploadMedia()` a genuine, durable Meta upload — worth reconsidering
  `metaMediaId` caching specifically for the Cloud API adapter once that
  milestone exists to observe real retry patterns against.
- **`downloadMedia()` buffers the entire file into memory rather than
  streaming it straight to object storage.** Simpler, and safe given Tier
  1's own 100MB ceiling (`src/services/media/limits.ts`) — worth revisiting
  only if a future tier needs to handle materially larger files.
- **The `Media` model has no Prisma relation to `Message`** — `mediaId`
  stays a plain scalar, resolved only through `src/data/media.ts`'s own
  organizationId-scoped functions (`attachMediaSummary`/
  `attachMediaSummaries`), mirroring the exact precedent
  `prisma/schema.prisma`'s M2-era comment already set for
  `Conversation.assignedUserId`/`Message.sentByUserId`. A batched lookup
  (`attachMediaSummaries`, one query per page) is used everywhere a list of
  messages crosses the wire, rather than relying on a Prisma `include` that
  doesn't exist.
- **`GET /api/media/:id` is a new route not listed in context.md §9's
  literal API surface.** That section predates the object-storage design
  decision (context.md §14 item 3, resolved Pre-M1); some authenticated,
  organizationId-scoped URL for the thread UI's `<img>`/`<video>`/
  `<audio>`/document-download elements to point at is structurally
  necessary for this milestone's own done-criterion to mean anything, and
  streaming through an authenticated Next.js route (rather than a
  presigned S3 URL handed straight to the browser) was chosen deliberately
  — see the next point.
- **`@aws-sdk/s3-request-presigner`, already a Phase-0-era dependency
  (anticipating exactly this need), ended up unused.** A presigned URL
  handed directly to the browser would mean the browser needs real network
  access to `OBJECT_STORAGE_ENDPOINT` — fine for a local MinIO on
  `localhost`, but that endpoint is typically an internal-only host in a
  real deployment (a Docker service name, a private VPC address), not
  something a browser can resolve. Streaming media through `GET
  /api/media/:id` (which itself talks to object storage server-side) works
  identically in both cases and keeps every media fetch behind the same
  session check as everything else in this codebase, at the cost of
  proxying bytes through the Next.js process rather than a direct
  browser-to-storage transfer. Worth revisiting if a CDN/presigned-URL
  approach becomes desirable for scale reasons later — the dependency is
  already installed for exactly that pivot.
- **MinIO does not auto-create its bucket.** `docker-compose.yml`'s
  `minio` service comment now documents the one-time `mc mb` step — this is
  a manual local-dev/ops step, not something `src/lib/storage/object-store.ts`
  automates (an `ensureBucketExists()` on every call, or on first use, was
  considered and rejected as unnecessary complexity for what is, in every
  real deployment, a one-time infrastructure-provisioning step, not
  something the application should be doing at runtime).
- **Location messages store `"lat,lng"` as plain text in `Message.body`,
  not a dedicated column.** context.md §7.4's literal schema has no
  lat/lng fields, and inventing one felt like a bigger schema commitment
  than this milestone's actual ask ("location (map link/coordinates)" in
  the UI). `src/lib/messages/render.ts`'s `parseLocationBody` is the one
  place this string shape is parsed back out — same "one place, not
  scattered string-parsing" discipline as `src/services/window.ts`'s
  `isWindowOpen`.

### Post-merge verification (2026-08-21) — the full loop, run for real, for the first time

~~**Unlike M1–M5, this milestone's own code was not run through
`tsc`/`vitest`/`eslint`/`next build` at all before being committed.**~~

~~**VERIFIED 2026-08-21**: the full loop now ran for real, in a genuinely
fresh environment (no pre-existing `node_modules`, no pre-existing
Postgres/Redis/MinIO state).~~ **Infra**: no Docker reachable in this
verification environment (same as every prior milestone's own story) — a
portable Node.js v22.14.0, PostgreSQL 16.4, Redis 5.0.14.1, and (new this
milestone) a real MinIO server were all stood up from standalone Windows
binaries. PostgreSQL's own binaries turned out to need the Microsoft
Visual C++ 2015-2022 x64 redistributable (`vcruntime140.dll`/
`msvcp140.dll`), which is not present on a bare Windows install and could
not be installed system-wide in this sandbox (no admin rights — the
installer hangs indefinitely waiting on a UAC elevation prompt that never
comes). Worked around by copying `vcruntime140.dll`/`vcruntime140_1.dll`
(already present locally, bundled with PostgreSQL's own pgAdmin 4 Python
distribution) and `msvcp140.dll` (already present locally, bundled with
Microsoft Edge) directly into `pgsql\bin\` alongside `initdb.exe`/
`postgres.exe` — Windows' DLL search order checks an executable's own
directory before `System32`, so this satisfies the dependency without any
system-wide install or admin rights. Worth installing the VC++ redist
properly (`https://aka.ms/vs/17/release/vc_redist.x64.exe`, needs admin)
on any machine where admin rights are available, rather than relying on
this workaround long-term.

**Three real bugs found and fixed, none of them cosmetic:**

1. **`src/providers/baileys/normalize.ts` used the `Long` type without
   importing it.** `BaileysMediaContent.fileLength` is typed
   `number | Long | null` (mirroring Baileys' own `toNumber()` signature in
   `lib/Utils/generics.d.ts`, which itself references a bare `Long` with no
   visible import in that file — invisible to us because `tsconfig.json`'s
   `skipLibCheck: true` skips type-checking `node_modules` `.d.ts` files).
   The identical bare reference in OUR OWN source is not exempt from
   checking, so `tsc --noEmit` failed with `Cannot find name 'Long'`. Fixed
   by adding `import type Long from "long";` — `long` is a real transitive
   dependency of `@whiskeysockets/baileys` (via protobufjs) and was already
   present in `node_modules`, so this needed no new dependency.
2. **`src/lib/logging/logger.ts`'s `LogFields` interface was missing the
   field names M6's new log call sites actually use.** `LogFields` is
   deliberately closed (M3's design — see its own doc comment) so a real
   call site needs its field added by name, not a widened index signature.
   `tsc --noEmit` caught nine call sites across
   `src/app/api/media/[id]/route.ts`, `src/services/media/download-and-store.ts`,
   `src/services/messages/send-message.ts`, and
   `src/worker/consumers/ingest-inbound.consumer.ts` using `mediaId`,
   `mimeType`, `sizeBytes`, and `hasMedia` — none of them message content,
   all legitimate metadata-about-a-file fields in the same spirit as the
   existing `messageId`/`provider`/`messageType` fields. Fixed by adding
   `mediaId?: string`, `mimeType?: string`, `sizeBytes?: number`, and
   `hasMedia?: boolean` to `LogFields`. One further call site,
   `src/worker/consumers/send-message.consumer.ts`'s "send-message job:
   sending" log line, used an ad hoc `type: message.type` field where the
   existing `messageType` field (already used one function away, in
   `ingest-inbound.consumer.ts`'s "message ingested" log line, for the
   identical concept) already covers it — fixed by renaming that one call
   site's field to `messageType` instead of adding a near-duplicate `type`
   field to the interface.
3. **A pre-existing (not M6) migration-ordering bug, only surfaced because
   this was the first time all three migrations were ever applied to a
   genuinely empty database in one `prisma migrate deploy` run.**
   `prisma/migrations/20260821000000_m1_tenancy`'s folder name sorts
   *after* `20260820213005_m2_provider_and_ingestion`'s (2026-08-21 >
   2026-08-20-21:30), so Prisma — which applies pending migrations in
   ascending folder-name order — tried to apply M2's migration (which adds
   a `Channel.organizationId` FK-shaped column referencing `Organization`)
   before M1's migration (which creates the `Organization` table),
   failing immediately with `relation "Organization" does not exist`. This
   never surfaced in M1's, M2's, or M5's own "migrations apply cleanly"
   verification because each of those sessions ran against a Postgres
   instance that already had M1's migration applied from an earlier
   session — the M1 migration was never pending at the same time as M2's
   until this pass's genuinely fresh database. Fixed by renaming the M1
   migration folder to `20260820200000_m1_tenancy` (sorts before M2's
   `20260820213005`). Re-verified by dropping the database, recreating it
   empty, and re-running `prisma migrate deploy` — all three migrations
   now apply cleanly, in the correct order (M1 → M2 → M6), on the first
   try. **If this repo's migration history is ever inspected against a
   database that already recorded the old `20260821000000_m1_tenancy`
   folder name in `_prisma_migrations`, the rename will look like a new,
   unapplied migration** — this rename is safe for any environment whose
   Postgres instance is being created fresh (true of every environment
   this repo has been verified against so far, including this one), but
   would need a manual `_prisma_migrations` row edit (or
   `prisma migrate resolve`) instead of a plain `migrate deploy` on any
   database that already has the old folder name recorded.

## M7/M8/M10 — unplanned work fix-up (2026-08-22)

Context: this work was not built by a Claude Code session — it was produced
by Gemini 3.1 Pro via the Antigravity IDE, found already uncommitted in the
working tree, and fixed (not discarded) per the user's explicit
instruction. Full narrative: `parallel-work-inventory.md`. This section
covers only the Meta-Cloud-API-specifics uncertainty context.md rule 1
cares about — everything else the fix-up touched is in `decisions.md` and
`PROGRESS.md`'s M7/M8/M10 section.

- **None of the Meta webhook/Graph API field names, shapes, or error codes
  used in `src/app/api/webhooks/meta/route.ts`, `src/providers/cloud-api/adapter.ts`,
  or `src/providers/cloud-api/error-map.ts` were fetched-and-confirmed
  against live Meta documentation by any session** — not Gemini's original
  pass (no citations or verification notes found anywhere in that code),
  and not this fix-up (out of scope for a compile/lint/test fix-up; this is
  real verification work M10 itself is supposed to do, per context.md rule 1
  and its own task list in `implementation-plan.md`). Specifically
  unverified: `hub.mode`/`hub.verify_token`/`hub.challenge`/
  `x-hub-signature-256` (webhook verification), the `whatsapp_business_account`/
  `entry`/`changes`/`value.metadata.phone_number_id`/`messages`/`statuses`
  payload shape, the `messaging_product`/`recipient_type`/message-type
  payload shapes for text/media/template sends, the media upload/download
  two-step flow's exact endpoints, and every numeric error code in
  `error-map.ts` (4, 190, 130429, 80007, 131047, 131026). These are
  plausible, commonly-documented values consistent with widely-known Meta
  Cloud API conventions — not fabricated — but "plausible from training
  data" is exactly what context.md rule 1 says not to trust for this API
  specifically, since it "changed materially" before. **Before actually
  flipping `WHATSAPP_PROVIDER` to `cloud-api` against a real account, fetch
  and read `https://developers.facebook.com/docs/whatsapp/cloud-api` and
  confirm every one of the above against it.**

  **RESOLVED 2026-09-09 — verification pass done against live Meta docs.**
  Every field name, payload shape, and error code listed above was fetched
  and checked against `developers.facebook.com`. **All of them are correct**
  as written; nothing in the list was fabricated or wrong. Details:

  | Checked | Verdict |
  |---|---|
  | `hub.mode` = `subscribe`, `hub.verify_token`, `hub.challenge`; echo challenge back | Confirmed |
  | `x-hub-signature-256`, HMAC-SHA256, `sha256=` prefix | Confirmed. `webhook-verify.ts` already strips the prefix and uses `timingSafeEqual` |
  | `object` = `whatsapp_business_account`; `entry[].changes[].value`; `field` = `messages` | Confirmed |
  | `value.metadata.phone_number_id` (and `display_phone_number`) | Confirmed |
  | `value.messages[]`: `id`, `from`, `timestamp`, `type`, `text.body` | Confirmed |
  | `value.contacts[0].profile.name` / `wa_id` | Confirmed |
  | `value.statuses[]`: `id`, `status`, `timestamp`, `recipient_id`, `errors[].code/.title/.message` | Confirmed |
  | Status values `sent`/`delivered`/`read`/`failed` | Confirmed — `failed` is real, so `mapMetaMessageStatus` is right |
  | Text send: `messaging_product`/`recipient_type`/`to`/`type`/`text.body` | Confirmed |
  | Template send: `template.name`, `template.language.code`, `components[].type="body"`, `parameters[].type="text"`/`.text` | Confirmed |
  | Mark read: `messaging_product`/`status:"read"`/`message_id` | Confirmed |
  | `recipient_type: "individual"` | Confirmed — required; allowed values `individual`, `group` |
  | Media download: `GET /{media-id}` -> `url`/`mime_type`/`sha256`/`file_size`/`id`, binary fetch needs the Bearer token | Confirmed |
  | Error codes 4, 190, 130429, 80007, 131047, 131026 | Confirmed, and all bucketed correctly retryable-vs-terminal |

  **Six real problems the same pass turned up — none of them wrong field
  names. All six were fixed on 2026-09-09; recorded here because the reasons
  outlive the diffs.**

  1. **FIXED — `mapMetaError()` never matched the error shape it is given, so
     every Meta error was terminal.** `callMetaAPI()` does `throw data` with
     the parsed Graph body (`{ error: { code, message } }`), but the mapper
     read only `err.response.data.error.code` (an *axios* shape; the adapter
     uses `fetch`) and a bare `err.code`. Neither ever matched: every Graph
     error fell through to `META_ERROR_UNKNOWN`, classified **terminal**. The
     five correctly-identified codes below were unreachable, and rate limits
     — the entire reason a retryable bucket exists — were permanently failing
     sends on the first attempt. This was the most consequential finding of
     the pass and was invisible to review, because the code *looked* right.
     All three shapes are now accepted, with `error-map.test.ts` pinning the
     one actually thrown.
  2. **FIXED — `uploadMedia()` omitted the required `type` form field.** Meta
     documents `POST /{phone-number-id}/media` as requiring **three** parts:
     `messaging_product`, `file`, **and `type`**. Every outbound media upload
     would have failed on first real use. No test caught it because M6's
     object-storage tests mock the provider; `adapter.upload.test.ts` now
     asserts all three parts.
  3. **FIXED — `131056` was being treated as terminal.** Too many messages to
     the same recipient pair in a short period: a *retryable* rate limit that
     was hitting the terminal catch-all, permanently failing sends that would
     have succeeded on retry. Also added `133010` (number not registered) and
     `131051` (unsupported message type) as explicit terminal codes, and a
     transport-error set (ECONNRESET/ETIMEDOUT/undici timeouts) as retryable.
     The catch-all stays terminal on purpose — an unrecognized code should
     surface, not retry forever.
  4. **FIXED — a late `failed` could retract a `delivered`.** Meta emits BOTH
     `delivered` and `failed` for one message when the recipient is on
     several devices and delivery succeeds on one but not another. This was
     **not** a missing guard: M4's `status-progression.ts` ranked FAILED above
     every status *deliberately*, which was correct for Baileys' semantics and
     wrong for Meta's. Fixed by revisiting the rule rather than special-casing
     around it — FAILED now ranks between SENT and DELIVERED, encoding
     "delivery is a positive fact and is not retracted by a later failure on
     another device". Consequence: FAILED is no longer terminal, so the
     reversed webhook order (`failed` then `delivered`) also converges on
     DELIVERED. Full reasoning is in that file's doc comment; both orderings
     are proven against real Postgres in
     `status-update.consumer.integration.test.ts`. This narrows context.md
     §7.4's "or into FAILED" to "from PENDING/SENT only".
  5. **FIXED — `GRAPH_API_VERSION` was hardcoded to `v20.0`.** Now read from
     `META_GRAPH_API_VERSION` (validated in `src/config/env.ts`, shape-checked
     against `/^v\d+\.\d+$/`, defaulting to `v26.0`), so the version is a
     deploy-time decision rather than a code change. **Not urgent**: v20.0
     expires 2026-09-24, but `WHATSAPP_PROVIDER=baileys` and this adapter has
     never made a real Graph call, so nothing breaks on that date — it is a
     Phase B prerequisite, not a deadline. Reading the v21–v26 changelogs for
     breaking changes belongs to M10 proper, when we actually connect.
  6. **FIXED (documented) — media URLs expire ~5 minutes after issue.** The
     download path already re-resolves the URL immediately before fetching
     bytes, so it was correct; the risk was a future "optimization" caching
     it. Now commented at the call site explaining why the extra round-trip
     is load-bearing.

  Still unverified after this pass, because docs alone cannot settle them:
  the interactive-reply payload shape (see the next bullet), and every one
  of the above against a **live** request. This pass upgrades the code from
  "plausible from training data" to "matches current published docs" — it
  does not make it exercised.
- **`InteractivePayload` extraction from a real Meta interactive-reply
  webhook was left unimplemented on purpose** (`extractInteractive()` in
  the webhook route always returns `null`) rather than guessing Meta's real
  button_reply/list_reply payload shape — the message still ingests
  correctly as its mapped type either way (`raw` preserves the original
  payload for later use), this is a deliberately deferred gap, not a
  silent one.
- **`ProviderTemplate.status`'s narrow 3-value union (`APPROVED`/`PENDING`/`REJECTED`,
  fixed at M2 — context.md §8.0.1) doesn't cover Meta's real template
  statuses** (context.md §4.2 itself names "paused/disabled states" as
  real, beyond just those three). `src/providers/cloud-api/adapter.ts`'s
  new `normalizeMetaTemplateStatus()` maps anything unrecognized to
  `PENDING` (never silently `APPROVED`) rather than widening the shared
  type — worth reconsidering whether `ProviderTemplate.status` should
  become a wider type (or a raw string, matching how `Template.status`
  itself is deliberately un-enumed) once M10 is actually being verified
  for real.
- **The M1 migration-ordering bug fix above (`20260821000000_m1_tenancy` →
  `20260820200000_m1_tenancy`) and this fix-up's two new migrations
  (`20260822010000_m7_m8_supporting_models`, `20260822081600_m10_webhook_event`)
  were both applied to, and verified against, the SAME already-partially-populated
  local Postgres instance Gemini's session had been using** (via
  `prisma migrate resolve --applied` for the models that already existed
  from an untracked `prisma db push`, and a genuine `prisma migrate dev`
  for the one that didn't) — not a from-empty database like M1–M6's own
  verification used. `prisma migrate status` reports clean against all 5
  migrations on this instance; worth a from-empty dry run (drop + recreate
  + `migrate deploy`) before trusting this migration set applies cleanly to
  a database that never had Gemini's untracked `db push` applied to it in
  the first place.

**Verification commands, actual output, this pass:**

- `npx tsc --noEmit` — clean, 0 errors (after fixes 1–2 above).
- `npx eslint .` — 0 errors, 0 warnings. Both
  `// eslint-disable-next-line @next/next/no-img-element` comments in
  `message-bubble.tsx`'s `ImageContent` (the inline thumbnail and the
  lightbox's full-size `<img>`) confirmed necessary and correctly placed —
  temporarily removing one and re-running ESLint reproduces exactly one
  `@next/next/no-img-element` violation at that line; restored immediately
  after.
- `npx vitest run` — 18 files, 101 tests, all passing.
- `npm run test:integration` — 15 files, 46 tests, all passing against the
  real Postgres + real Redis described above (`src/lib/storage/object-store.ts`
  still mocked in this suite specifically, by design — see above).
- `npm run build` — Next.js/Turbopack production build succeeds; every API
  route including `/api/media/[id]` lists as dynamic (`ƒ`).
- Manual smoke test of `src/lib/storage/object-store.ts` against the real
  MinIO instance (outside the automated suite, since that suite
  deliberately keeps object storage mocked) — see PROGRESS.md's M6
  post-merge verification note for what this confirmed.
