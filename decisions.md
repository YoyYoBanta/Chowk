# decisions.md — log of meaningful decisions made while changing this codebase

> Append-only decision log. An entry goes here whenever a change involves a real
> tradeoff — an architectural choice, a scope call, a naming/shape decision, a
> "considered X, went with Y instead" — not routine implementation. Distinct from
> the other two root-level logs:
> - `TODO-VERIFY.md` — specifically uncertain **third-party API details** (Meta,
>   Baileys, AWS SDK, ...) that were flagged instead of guessed, with citations.
> - `PROGRESS.md` — milestone-level status: what works, what's stubbed, what
>   needs human verification.
>
> This file is the **why** behind implementation choices in general, whether or
> not they touch an external API. Newest entries at the bottom of each
> milestone's section; new milestones appended below the last one.

---

## M1–M5 (2026-08-21, prior sessions)

Not backfilled entry-by-entry here — the equivalent judgment calls for these
milestones are already recorded in `TODO-VERIFY.md`'s M1–M5 sections (each has
its own "judgment calls made building this milestone" subsection). This file
starts being the canonical decision log from M6 onward.

---

## M6 — Media (2026-08-21)

### Serve stored media through an authenticated app route, not a presigned S3 URL
**Decision:** `GET /api/media/:id` (new route, org-scoped session check) streams
object-storage bytes server-side, rather than handing the browser a presigned
MinIO/S3 URL directly.
**Why:** A presigned URL requires the browser to have real network access to
`OBJECT_STORAGE_ENDPOINT` — fine for MinIO on `localhost`, but that endpoint is
typically internal-only in a real deployment (a Docker service name, a private
VPC address). Streaming through an authenticated route works identically in
both cases and keeps every media fetch behind the same session check as
everything else in the app.
**Considered and rejected:** presigned URLs via `@aws-sdk/s3-request-presigner`
(already installed at Phase 0, anticipating this). Left unused; worth
reconsidering if direct browser-to-storage transfer becomes desirable for
scale reasons.

### No dedicated lat/lng columns for LOCATION messages
**Decision:** Coordinates are captured into `Message.body` as a plain
`"lat,lng"` string; `src/lib/messages/render.ts`'s `parseLocationBody` is the
one place that shape is parsed back out for rendering a map link.
**Why:** `context.md`'s §7.4 schema has no lat/lng fields, and adding one felt
like a bigger schema commitment than the actual ask ("location: map
link/coordinates" in the UI spec).
**Considered and rejected:** a new `Message.latitude`/`longitude` column pair.

### `message.updated` is a new realtime event type, not reused `message.status_changed`
**Decision:** When an inbound message's media finishes downloading and
`mediaId` gets linked, a new `message.updated` SSE event fires — not
`message.status_changed`.
**Why:** `status_changed` implies the `Message.status` field moved; an inbound
message's `status` is meaningless (that field only progresses for outbound
sends). Reusing it would have been a misleading signal for anything consuming
the event stream.

### Baileys media re-uploads fresh on every send attempt — no provider-id caching across retries
**Decision:** `Media.metaMediaId` exists in the schema and could cache a
provider-returned media reference to skip re-uploading on a BullMQ retry, but
this isn't done for the Baileys path.
**Why:** Baileys' own `uploadMedia()` only keeps the buffer in an
adapter-local in-memory `Map` (`outboundMediaCache`). If a Worker restart
landed between "upload" and a later retry's "send," a cached id would point at
a buffer that no longer exists — a permanently-broken reference is worse than
a harmless, slightly wasteful re-upload. Always re-uploading fresh sidesteps
the trap entirely.
**Worth revisiting:** once Phase B (M10) makes `uploadMedia()` a genuine,
durable Meta upload, caching `metaMediaId` there specifically becomes safe and
worth doing.

### `Message.mediaId` stays null until an inbound download actually completes (fixes a latent M2 bug)
**Decision:** The M2-era ingest-inbound consumer stored the *provider's own*
transient media reference (a Baileys `directPath` / a future Meta media id)
straight into `Message.mediaId`, as if that were a `Media.id` foreign key —
which never existed before M6. Fixed as part of this milestone's own work: the
field is now left `null` at ingest time and only set once
`download-and-store.ts` actually downloads, stores, and creates the real
`Media` row.
**Why flagged here, not just fixed silently:** it's a real behavior change to
existing M2 code, done in service of a new feature rather than as an isolated
bugfix commit — worth being explicit that the old value was never meaningful.

### `MediaReference` extended with `directPath`/`url`/`mediaKey` (Phase-A-only fields)
**Decision:** Added three optional fields to the shared, provider-agnostic
`MediaReference` type, documented as "Baileys/Phase A only."
**Why:** Baileys media is end-to-end encrypted — decrypting it needs the CDN
location (`directPath`, falling back to `url`) and the per-message decryption
key (`mediaKey`, base64). Without these, `downloadMedia()` has no way to
actually decrypt anything. Meta's Cloud API (Phase B) hands back plaintext
bytes over an authenticated GET, so these fields simply stay undefined for a
Cloud-API-sourced reference — the interface stays one shared shape rather than
forking into per-provider reference types.

### `downloadMedia()` buffers the whole file into memory rather than streaming to storage
**Decision:** Baileys' decrypted stream is fully collected into a `Buffer`
before `putObject()` is called, instead of piping the stream straight through.
**Why:** Simpler, and safe given Tier 1's own enforced ceiling (100MB
documents, smaller for other kinds — `src/services/media/limits.ts`).
**Worth revisiting:** only if a future tier needs to handle materially larger
files.

### Integration tests mock two seams this milestone, not one
**Decision:** `src/lib/storage/object-store.ts` joins `src/providers/factory.ts`
as a second sanctioned mock seam in integration tests (previously only the
provider factory was ever mocked; Prisma/Redis/BullMQ stayed real).
**Why:** There is no S3-compatible object storage reachable in any environment
this codebase has been developed in so far — same category of gap as "no
dedicated WhatsApp test number." Mocking it proves the pipeline's own logic
(idempotency, row linking, the realtime publish) for real against Postgres,
while leaving "does `putObject()` reach a real bucket" as an explicit,
separately-tracked verification gap rather than a silently-assumed pass.

### Phase A test number resolved: the human's personal number, temporarily
**Decision:** context.md §14 item 1 ("which number is the Phase A test
number — must be dedicated, no real relationships attached") is resolved as:
the maintainer's own personal WhatsApp number, explicitly against the
spec's own recommendation, with an explicit plan to disconnect it from
Baileys once the project no longer needs live testing.
**Why flagged here:** this was raised and pushed back on twice (the ban
risk is real, no-appeal, and this number is tied to personal/banking
notifications) before the maintainer confirmed the choice knowingly. Not a
decision made or endorsed unilaterally — recorded so the risk and the exit
plan are both on record, not just in chat history.

### Pairing via GitHub Codespaces, not a local dev environment
**Decision:** The live pairing of the WhatsApp number will be executed inside a GitHub Codespace.
**Why:** The host machine currently lacks a local Node and Docker installation. Pairing Baileys requires a live terminal where the QR code can be actively observed and scanned by the human operator's mobile device. Running the stack (`npm run worker`) and the activation script (`npm run activate-channel`) directly in a Codespace avoids the local dependency roadblock while providing the required live stdout stream.

### Channel pairing: a boot-time auto-connect loop + a CLI script, not an admin UI
**Decision:** `src/worker/index.ts`'s `connectActiveChannels()` now calls
`provider.connect()` for every `ACTIVE` channel across every org on Worker
boot (previously deliberately deferred — see the removed doc comment this
replaced). `scripts/activate-channel.ts` (new, `npm run activate-channel`)
flips a channel's status to `ACTIVE` from the CLI. A channel with no
previously-paired session prints a scannable QR to the Worker's stdout
(`qrcode-terminal`, new dependency).
**Why:** an admin UI for connecting channels is explicit M9 scope
(`context.md`'s build order) — building it early to unblock live testing
now would be exactly the kind of scope-jump `context.md` rule 3 warns
against ("do not scaffold all modules at once"). A CLI script is a "trusted,
non-request-scoped" ops tool in the same category `src/data/organizations.ts`
already documents `listOrganizations()` as existing for — no product-facing
surface added, no milestone skipped ahead.
**Considered and rejected:** building the M9 admin channel screen now. Also
considered: a one-off standalone pairing script separate from the Worker
process — rejected because the Worker is architecturally the one place a
Baileys socket is allowed to live (architecture.md §3); a separate script
would open a second, conflicting connection using the same session
credentials.

### MinIO bucket creation is a manual step, not automated in application code
**Decision:** `docker-compose.yml`'s comment documents the one-time `mc mb`
step; `src/lib/storage/object-store.ts` does not call `HeadBucket`/
`CreateBucket` on startup or first use.
**Why:** Bucket provisioning is a one-time infrastructure concern in every
real deployment, not something the application should be doing at runtime. An
`ensureBucketExists()` was considered and rejected as unnecessary complexity
for what should be a `terraform`/ops-script/manual-console concern.

---

## M7/M8/M10 fix-up (2026-08-22)

Unplanned work — produced by Gemini 3.1 Pro via Antigravity, found
uncommitted, source confirmed by the user after two Claude Code sessions
couldn't identify it. Full narrative in `parallel-work-inventory.md`;
`PROGRESS.md`'s M7/M8/M10 section has the "what works / what doesn't"
breakdown. This section is just the real decisions made while fixing it.

### Fix, don't discard — even though the work skipped the required build order
**Decision:** per the user's explicit instruction, kept the M7/M8/M10 code
and repaired it (schema/migration/compile/lint/test/build) rather than
reverting to the clean M6 state and rebuilding M7 onward in order.
**Why:** the user's call to make, not mine — they were told plainly that
this skips context.md §11's "do not start M10 until M1–M9 are done and
used" gate, and chose to keep it anyway. Recorded here so the deviation
from the documented build order is traceable to an explicit decision, not
an oversight.

### Template language travels in `templatePayload`, not a new `Message` column
**Decision:** `Message.templatePayload` (already `Json?` in the schema)
now stores `{ languageCode, variables }` instead of just `variables` — the
worker's send-time re-check needs to know which language variant to look
up, and there's no dedicated column for it.
**Why:** context.md §7.4's literal schema has no language column on
`Message`, and the same "don't add a column for something JSON can carry
without a real modeling reason" judgment this codebase already made for
LOCATION coordinates (see the M6 section above) applies here too.
**Considered and rejected:** a new `Message.templateLanguage` column.

### Send-time template re-check happens at both the service layer and the Worker
**Decision:** `sendTemplateMessage()` (API-request time) and
`sendTemplateViaProvider()` (actual-send time, inside the Worker) both
independently look up the `Template` row and check `status === "APPROVED"`.
**Why:** exactly the defense-in-depth precedent M5's window check already
established (`src/services/messages/send-message.ts` + `src/providers/baileys/simulate-window.ts`)
— a template's status can flip (Meta sync, or a paused/rejected status
landing) in the gap between a request being accepted and the Worker job
actually running, and context.md §8.4 is explicit that the check belongs
at send time, "not just at selection time."

### Contact panel's fake demo data replaced with an honest placeholder, not built out
**Decision:** the panel showed hardcoded sample values ("VIP Customer",
"Acme Corp", "$4,200") for tags/custom fields that don't actually exist for
any real contact. Replaced with "Not wired up in this panel yet" rather
than either leaving the fake data or building the real integration.
**Why:** the backend (data layer + API routes) for tags/custom fields
already exists and works — only this one panel's UI never calls it. Fully
wiring it up was judged out of scope for a fix-up pass (real feature work,
not a bug fix); leaving fabricated data in a product a real user might look
at was judged worse than an honest "not yet" — matching this codebase's
own established convention from M3's original read-only contact panel.
**Worth doing properly later:** wire the panel to the real
`/api/contacts/:id/tags` and custom-fields routes.

---

## M7/M8 completion pass (2026-08-22)

Follow-up to the fix-up above, per the user's explicit instruction to
finish M7/M8's remaining "not done" items properly rather than leave them
as a permanent partial state.

### `ContactTag` gained real Prisma relations instead of bare scalar columns
**Decision:** added `Contact.tags`/`Tag.contacts` back-relations and
`ContactTag.contact`/`ContactTag.tag` forward relations, each
`onDelete: Cascade`; `Note.contact` similarly.
**Why:** the model as originally written (`contactId String; tagId
String`, no `@relation` at all) had no FK constraint and no cascade —
deleting a Contact or Tag left orphaned `ContactTag` rows with nothing
enforcing referential integrity, and `include: { tag: true }` was simply
impossible without a named relation. This surfaced immediately while
wiring the contact panel's tag list (needed `getContactTags` to actually
join through to `Tag`). New migration `20260822090816_m8_crm_relations`.

### "Mine"/"Unassigned" filter translation lives in the route, not the data layer
**Decision:** `GET /api/conversations` translates the UI's
`assignedUserId=unassigned`/`=me` query values to `null`/the session's own
`userId` before calling `listConversationsPage` — the data layer only ever
sees a real user id or `null`, never a sentinel string.
**Why:** `"me"` only means anything relative to the requesting session,
which the data layer deliberately has no access to (organizationId-first,
no session threading below the route layer). Putting the translation in
the data layer would have meant passing the session's userId down through
`opts` for no other reason, muddying a function whose contract is
otherwise "just a filter value." This was also a real, live bug fix: both
filters previously matched zero conversations, since no row's
`assignedUserId` is ever literally the string `"unassigned"` or `"me"`.

### Template variable-mismatch validation is request-time only, not duplicated at the Worker
**Decision:** `validateTemplateVariables` (`src/lib/templates/variables.ts`)
runs once, in `sendTemplateMessage`, before the PENDING row is written —
unlike the APPROVED check, it is not repeated in the Worker's
`sendTemplateViaProvider`.
**Why:** the APPROVED check is duplicated because a template's approval
status can genuinely change in the gap between request and Worker
execution (a real race). A template's own `{{n}}` placeholders don't
change between those two points — the values already got frozen into
`Message.templatePayload` at request time — so re-validating the same
frozen data at send time would catch nothing a request-time check didn't
already catch. Not the same category of check as the window/APPROVED
defense-in-depth precedent.

### The 15-minute template sync scheduler lives in the Worker process, not a cron/serverless function
**Decision:** `src/worker/scheduler.ts`'s `startTemplateSyncScheduler()` is
a plain `setInterval` inside the same long-running Worker process that
already holds the Baileys sockets and BullMQ consumers, started in
`main()` and `.stop()`d on the same SIGINT/SIGTERM shutdown path.
**Why:** matches architecture.md §3/§4's explicit statement that the
Worker owns "scheduled jobs" alongside everything else — introducing a
second process (a cron container, a serverless scheduled function) for
one 15-minute sweep would be new infrastructure for something the
existing process is already documented to own. Fires once immediately on
boot (not just on the first 15-minute tick) so a Worker restart doesn't
leave a stale template list for up to 15 minutes.

---

## Persist the real phone number on connect (2026-08-22)

### `Channel.phoneNumber` is written from `sock.user` once Baileys reports `connection === "open"`, not left at its placeholder
**Decision:** `handleConnectionUpdate()`'s open branch now decodes
`sock.user.jid`/`sock.user.id` via Baileys' own `jidDecode()` and persists
the digits through a new `updateChannelPhoneNumber()` (`src/data/channels.ts`)
data function, alongside the existing in-memory `connectionStates` update.
**Why:** `createChannel()` requires a `phoneNumber` at creation time, before
any real number is known (seed data uses a `"000000000000"` placeholder) —
nothing ever updated it afterward, so the DB/admin-facing value stayed wrong
indefinitely even once a channel paired successfully and worked correctly in
every functional sense. `sock.user` is only populated once the socket is
actually open, making the `"open"` transition the first and only correct
place to learn the real number.
**Verified live**, not just compiled: restarted the Worker against the
already-paired session (`channel cmt42u419000aaouh6gf9rl1n`, previously
linked via Gemini's session) — reconnected using stored credentials with no
QR re-scan required, and `Channel.phoneNumber` updated from the placeholder
to the real `918360814577` on that connect.

---

## M7/M8 checklist completion pass (2026-08-23)

The earlier fix-up/completion passes (2026-08-22) closed the bugs and gaps
found along the way but were never checked against `implementation-plan.md`'s
own literal task lists line by line. Doing that audit surfaced several real,
still-open items — this section covers the decisions made closing them.

### User deactivation is enforced at login, not just a cosmetic flag
**Decision:** `User.isActive` (new) is checked inside `loginWithPassword`,
after a password match, before `createSession()` — a deactivated user with
the correct password gets the exact same generic error as a wrong password.
**Why:** a "Deactivate" button that only hides a user from a list without
actually preventing them from signing in would be misleading — the whole
point of the admin task (context.md §10.6) is that deactivation is a real
access control, not a display filter. The generic-error choice matches this
codebase's existing precedent (`loginWithPassword`'s own `GENERIC_ERROR`,
used for every failure mode already) — a distinct "this account is
deactivated" message would let a login attempt be used to enumerate which
accounts exist and have been deactivated.

### Invited users get a one-time generated password, not an email
**Decision:** `POST /api/users` generates a random temporary password
(`randomUUID().slice(0, 12)`) and returns it once in the response body for
the admin to relay out-of-band.
**Why:** no email delivery integration exists anywhere in this codebase
(context.md never specifies one for Tier 1), and building one just to
unblock the invite flow would be real scope creep for what this task
actually needs. Matches the same honest "local-dev equivalent, not a fake
implementation" call already made for the QR-pairing flow and template
rejection reasons — the admin sees exactly what a real system would need to
deliver, just relayed manually instead of via SMTP.

### An admin cannot change their own role or deactivate their own account
**Decision:** `PATCH /api/users/:id` refuses the request (400) when `id`
equals the caller's own `userId`, regardless of what `role`/`isActive`
values are sent.
**Why:** without this, a single-admin organization (true of both seeded
orgs today) could lock itself out of its own admin screen with one
misclick, with no recovery path short of a direct database edit. A small,
common safety rule, enforced in the route (a request-context decision —
"who is asking" — not a tenancy concern the data layer should own).

### The conversation list's channel filter reads from the initial page load, not a live admin-gated fetch
**Decision:** `channelOptions` in `conversation-list.tsx` is derived from
the `initialConversations` prop (the server-rendered first page) via
`useMemo`, not a fetch to `/api/channels`.
**Why:** `/api/channels` is deliberately admin-only (context.md §9,
enforced since the M6/M7 fix-up's `GET /api/channels` addition) — looping
every agent through an admin-gated endpoint just to populate a filter
dropdown would mean either loosening that boundary or adding a second,
duplicate channel-listing route. Deriving from data agents already have
(their own conversation list) avoids both, at the honest cost that a
channel with zero currently-open conversations won't appear as a filter
option until one exists.

### Note author name is resolved in the route, not via a schema relation
**Decision:** `GET /api/contacts/:id/notes` batch-fetches the org's users
and attaches `authorName` to each note by matching `authorUserId`, rather
than adding a `Note.author` relation to `User`.
**Why:** matches this codebase's existing, deliberate precedent for
`Conversation.assignedUserId`/`Message.sentByUserId` — user references
elsewhere in the schema stay plain scalars, not enforced foreign keys (see
prisma/schema.prisma's own comment on `Conversation.assignedUserId`).
Adding one relation just for `Note` while every sibling field stays a
scalar would be an inconsistent, one-off exception with no real benefit —
the route-level join costs one extra query, not a schema commitment.

---

## M9 — Search and hardening (2026-08-24)

### Message search performance is a hand-written `pg_trgm` migration, not a schema.prisma declaration
**Decision:** `CREATE EXTENSION IF NOT EXISTS pg_trgm` + `CREATE INDEX ...
USING gin ("body" gin_trgm_ops)` live in a plain SQL migration
(`20260824130424_m9_message_search_index`), invisible to `schema.prisma`
itself.
**Why:** this Prisma version has no stable, declarative syntax for a
Postgres GIN(gin_trgm_ops) index without turning on preview features
(`postgresqlExtensions`) this project hasn't otherwise needed anywhere
else — adding one just for this index would be a bigger commitment than
the index itself. Matches this repo's own established precedent (the
M7/M8 relations migration and others) of hand-writing migration SQL when
the declarative schema can't express something.
**Considered and rejected:** enabling `postgresqlExtensions` and declaring
the index in `schema.prisma` directly — more "discoverable" from the
schema file alone, but a real, standing change to how every future
migration in this project gets generated, for the sake of one index.

### Admin/CRM management lists stay plain arrays, not cursor-paginated
**Decision:** `Conversation`/`Message` are cursor-paginated (since M3);
`Tag`/`QuickReply`/`CustomFieldDefinition`/`User`/`Channel`/per-channel
`Template` list endpoints are not, and this milestone's pagination audit
left them that way.
**Why:** context.md §9's "every list endpoint is cursor-paginated" rule
exists because Conversation/Message volume is genuinely unbounded and
grows with real usage — the failure mode it guards against ("offset
pagination will break") doesn't apply to a collection whose size is
bounded by how many tags/users/templates one organization's admin
actually creates, realistically dozens, not thousands. Paginating those
anyway would add real complexity (cursor encode/decode, "load more" UI)
for collections that will never need it.
**Worth revisiting:** only if a specific organization's tag/quick-reply
count ever grows large enough to make the flat list genuinely slow to
render — not expected at this project's stated scale.

### Stuck-PENDING reconciliation marks FAILED, never re-enqueues
**Decision:** `reconcileStuckPendingMessagesForOrg` (30-minute threshold)
calls `markMessageFailed` directly; it never calls `getSendMessageQueue().add(...)`
again for the same message.
**Why:** re-enqueueing a message that might already have a job in flight
risks two workers both passing `processSendMessageJob`'s idempotency
guard (`status !== PENDING -> skip`) before either has written a new
status, and both calling the real provider — an actual double-send, not
just a wasted retry. A definitive `FAILED` (visible to the agent, same
precedent `markSendMessageJobExhausted` already set for "retries
genuinely exhausted") is the safe resolution; the agent can always
compose and send again. The 30-minute threshold is deliberately generous
— `send-message`'s own worst-case retry span (5 attempts, exponential
backoff from 2s) finishes in under a minute, so this only ever fires for
the rare case where the normal retry-then-fail path itself never ran at
all (e.g. the job never reached Redis), not to race BullMQ's own backoff.

### The forced-restart test uses its own private BullMQ queue, not the shared `send-message` queue
**Decision:** `src/worker/forced-restart.integration.test.ts` creates a
uniquely-named `Queue`/`Worker` pair for the duration of the test, and
drives the real `processSendMessageJob` function through it directly
(bypassing `sendTextMessage()`'s own enqueue onto the real queue).
**Why:** the first version of this test used the real `send-message`
queue and `sendTextMessage()`, and failed intermittently — not from a bug
in the code under test, but because a genuine, separately-running
`npm run worker` process (this project's normal local dev setup, holding
the live paired WhatsApp session) was racing the test's own Worker
instances for the exact same job, using the real, un-mocked provider.
Confirmed by stopping that process once and watching the test pass
reliably, then permanently fixed by giving the test exclusive ownership
of its own queue instead of repeatedly needing to stop a live process to
run the suite. `processSendMessageJob` only ever depends on
`{ organizationId, messageId }`, never which queue delivered the job, so
this required no change to the function under test itself.
**Considered and rejected:** stopping the real worker process as a
standing prerequisite for running the integration suite — fragile (easy
to forget, disrupts real local development) and unnecessary once the
actual root cause (shared queue name) was identified and fixed properly.

---

## Integration tests now run against a dedicated `_test` database (2026-08-26)

### `vitest.integration.config.ts` rewrites `DATABASE_URL` to a `_test`-suffixed database, unconditionally
**Decision:** the integration test config now appends `_test` to whatever
database name `.env`'s `DATABASE_URL` points at, before any test file is
loaded — `chowk` (local dev) becomes `chowk_test`.
**Why:** this was a real, user-visible bug, not a hypothetical. Every
integration test's `afterAll` cleanup is best-effort — an interrupted run
(a crashed process, a background test runner killed mid-suite) can leave
fixture data behind — and until this fix, `DATABASE_URL` was whatever
`.env` pointed at: the exact same database `npm run dev`/`npm run worker`
use. A leftover fixture from `messages.search.integration.test.ts`'s
10,000+-row load test (an interrupted `beforeAll`, from before its
timeout was fixed) showed up as a garbled contact name in the actual
local inbox the maintainer was looking at, sitting alongside their real
paired-WhatsApp-account contacts. Verified the fix is real, not assumed:
polled `pg_stat_activity` during a live test run and confirmed every
query hit `chowk_test`, none hit `chowk`.
**Considered and rejected:** relying on `afterAll` cleanup alone
(already the status quo, and already demonstrably insufficient — that's
what caused the leak). Requiring developers to remember to point
`DATABASE_URL` at a different database only when running tests (fragile,
opt-in, the same category of problem as the private-queue fix above).
**Follow-up captured in `docker-compose.yml`'s own setup comment**: a
fresh environment needs `chowk_test` created and migrated once, the same
one-time-setup category as MinIO's bucket creation.
