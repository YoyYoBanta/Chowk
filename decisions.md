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
