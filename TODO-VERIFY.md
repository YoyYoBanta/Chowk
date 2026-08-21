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
