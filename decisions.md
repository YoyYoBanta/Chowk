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
