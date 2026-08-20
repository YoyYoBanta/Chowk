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
