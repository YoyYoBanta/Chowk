# M7 live-delivery verification (Baileys, real handset)

The one M7 acceptance criterion that no test in this repo can satisfy.

`implementation-plan.md`'s M7 "Done when" is: *a template is sent to a
conversation with a closed window and arrives correctly with variables
substituted.* It is currently marked **Met** on the strength of
`send-message.template.integration.test.ts`, which uses a **mocked provider**.
That test proves the service and Worker layers — the `APPROVED` re-check, the
variable validation, the `templatePayload`, the PENDING→SENT progression.

It stops at the provider boundary. Everything below is unproven by any test:

- `BaileysProvider.sendTemplate()`'s substitution of `{{n}}` into the body
  (`src/providers/baileys/adapter.ts`)
- the handoff to `_doSendText()` and the real socket write
- what actually lands on a recipient's phone

This procedure closes that gap. Run it once, record the result, and update
`TODO-VERIFY.md` and `PROGRESS.md` with what was observed.

---

## Before you start: the number will probably be banned

Baileys is an unofficial, reverse-engineered WhatsApp client. Meta bans
accounts detected using it. **The ban is permanent, applies to the phone
number's WhatsApp account, and there is no appeal process.**

Therefore:

- Use a **dedicated throwaway number**. Never a personal number, never a
  business number, never a number with real contacts in it.
- Assume the number is expendable from the moment you pair it.
- Do not pair a number you would mind losing tomorrow.

If you do not have a throwaway number in hand, **stop here.** There is no
partial version of this procedure worth running on a real number.

### Why the procedure warms the conversation first

A brand-new WhatsApp account whose first action is unsolicited outbound
messaging is the single most ban-triggering pattern there is. So step 6 has
the recipient message us **first**, and step 7 forces the 24-hour window shut
by backdating a timestamp in Postgres rather than by waiting 24 hours or by
cold-messaging a stranger.

The delivery being verified stays completely real — only the clock is
synthetic. `isWindowOpen` is computed fresh from `Conversation.lastInboundAt`
on every read and is never cached (`src/services/window.ts`), so a backdated
timestamp puts the app in a genuinely closed-window state.

---

## Prerequisites

| Item | Notes |
|---|---|
| Throwaway number **with WhatsApp activated on a real handset** | Baileys pairs as a **linked device**. A bare SIM is not enough — you must be able to open WhatsApp → Settings → Linked Devices → Link a device and scan a QR. |
| A second number to receive the message | Your own phone is fine. It only receives a normal WhatsApp message; the ban risk sits with the paired account, not the recipient. |
| Infra running | `.\start-infra.ps1` (Postgres, Redis, MinIO) |
| Migrations + seed applied | `npx prisma migrate deploy` then `npm run seed` |

On a machine without Node on PATH (the portable `.infra\` setup), prefix every
shell with:

```powershell
$env:Path = (Resolve-Path ".\.infra\node-v26.7.0-win-x64").Path + ";" + $env:Path
```

You do **not** need to set the channel's phone number by hand. It is seeded as
the placeholder `000000000000` and overwritten with the real paired number on
connect (`adapter.ts`, the `connection === "open"` branch).

---

## Procedure

### 1. Start infra

```powershell
.\start-infra.ps1
```

### 2. Find the channel id

```powershell
npm run activate-channel
```

Prints every org's channels. Take the id of a `baileys` channel — e.g. the
seeded *Acme Textiles WhatsApp (Baileys, dev)*.

### 3. Activate it

```powershell
npm run activate-channel -- <channelId>
```

Flips `Channel.status` to `ACTIVE` so the Worker will pair it on boot.

### 4. Pair the channel

You can pair using the standalone pairing script:

```powershell
npm run pair
# Or specify a channel id explicitly:
# npm run pair -- <channelId>
```

Or start the worker directly (`npm run worker`).

With no stored session the adapter prints a **QR code to stdout**
(`qrcode-terminal`). On the throwaway handset: WhatsApp → Settings → Linked
Devices → Link a device → scan.

Wait for:

```
[baileys] channel <id> connected — session paired and live.
```

Leave the Worker running for the rest of the procedure. It holds the socket;
nothing sends without it.

Verify the pairing persisted:

```sql
SELECT id, "phoneNumber", status, "sessionRef" FROM "Channel" WHERE id = '<channelId>';
SELECT count(*) FROM "BaileysSessionData";
```

`phoneNumber` should now be the **real** paired number (not `000000000000`),
`status` = `ACTIVE`, `sessionRef` non-empty, and one session row present.

### 5. Start the app

In a second shell:

```powershell
npm run dev
```

Log in as the seeded admin: `admin@acme.chowk.test` / `chowk-dev-password`
(see `prisma/seed.ts`; the other seeded users share the same dev password).

### 6. Warm the conversation — recipient messages us first

From the **recipient's** phone, send any message to the throwaway number.

This must happen before any outbound. It creates the `Contact` and
`Conversation` rows through the real ingestion pipeline, and it establishes a
genuine prior interaction so the outbound is a reply rather than a cold send.

Confirm it arrived in the inbox UI, then capture the conversation id:

```sql
SELECT c.id, ct."waId", c."lastInboundAt", c."lastMessageAt"
FROM "Conversation" c
JOIN "Contact" ct ON ct.id = c."contactId"
ORDER BY c."lastMessageAt" DESC
LIMIT 5;
```

### 7. Create the test template

In the app: **Dashboard → Admin → Templates → Create a template**.

Pick the channel you paired, then use a body that exercises the substitution
edge cases, not just the happy path:

```
Hi {{1}}, your order {{2}} is ready. Ref {{1}}.
```

`{{1}}` is deliberately repeated — a single-pass substitution must replace
**both** occurrences.

The Baileys adapter writes locally with status `APPROVED` immediately
(`adapter.ts` `createTemplate`, per context.md §8.0.4), so there is no approval
wait. The channel must be connected for this to work, which is why it comes
after step 4.

### 8. Force the window closed

This is the step that makes it an M7 test rather than an M4 test.

```sql
UPDATE "Conversation"
SET "lastInboundAt" = now() - interval '25 hours'
WHERE id = '<conversationId>';
```

25 hours, not exactly 24, to stay clear of the boundary while the test runs.

Via the portable psql:

```powershell
& ".\.infra\pgsql\bin\psql.exe" -U postgres -h localhost -d chowk -p 5432 `
  -c "UPDATE ""Conversation"" SET ""lastInboundAt"" = now() - interval '25 hours' WHERE id = '<conversationId>';"
```

Reload the thread. The composer must now show its **closed-window** state —
free-text send disabled, template send offered. If it still looks open, the
backdate did not apply to the conversation you have open.

### 9. Send the template

Open the template picker, choose the template, and fill the variables. Use
values that would expose the bug fixed on 2026-09-09:

| Variable | Value |
|---|---|
| `{{1}}` | `Asha` |
| `{{2}}` | `see {{2}} now` |

The value for `{{2}}` deliberately contains a literal `{{2}}`. Agent-typed
text is data and must never be re-expanded as a template.

**Before sending, record what the live preview shows.** Expected:

```
Hi Asha, your order see {{2}} now is ready. Ref Asha.
```

Then send.

---

## What to check on the handset

On the **recipient's** phone, the received message must read **exactly**:

```
Hi Asha, your order see {{2}} now is ready. Ref Asha.
```

Check each of these separately — they fail independently:

1. **The message arrives at all.** This is the core unproven claim: a real
   socket write reaching a real phone.
2. **Both `{{1}}` occurrences are substituted** — "Hi Asha" *and* "Ref Asha".
   A regression here means only the first occurrence was replaced.
3. **The literal `{{2}}` inside the agent's value survives verbatim.** If the
   handset shows `see see {{2}} now now` or `see X X`-style doubling, the
   sequential-substitution bug is back (see below).
4. **The handset text matches the preview from step 9 character for
   character.** Any divergence means the preview and send paths have drifted
   apart again.
5. **No literal `{{n}}` remains for a variable you did supply.**

Then back in the app:

- The message row progresses `PENDING` → `SENT` (not stuck, not `FAILED`).
- The thread renders the substituted body, not the raw template.

### Regression context for checks 3 and 4

Until 2026-09-09 the send path looped over the supplied variables running one
`split`/`join` per key, so a value substituted for an earlier key was rescanned
by every later key's pass. Meanwhile the picker's preview used a single-pass
regex. The two could therefore disagree: the agent previewed
`see {{2}} X` while the recipient received `see X X`.

Both now call `substituteTemplateVariables` in
`src/lib/templates/variables.ts`. Checks 3 and 4 are the only place that
sharing is verified *on the wire* — `variables.test.ts` covers the helper, but
only a real handset proves the send path actually uses it.

---

## Record the result

Live verification is worth little if the outcome is not written down.

- **`TODO-VERIFY.md`** — its M7 entry says real delivery via Baileys' actual
  `sendText()` substitution path is unverified against a live number. Update it
  with the date, the outcome, and the exact string received.
- **`PROGRESS.md`** — note that M7's "Done when" is now met against a live
  handset rather than only a mocked provider.
- **`project_status.md`** — line 16 currently reads "still Baileys-only, never
  exercised against a real Meta template review". Real Meta review is M10 and
  stays untouched by this; only the Baileys delivery claim changes.

Record failures in the same places. A failed live test is a real finding and
is exactly the kind of thing the mocked suite cannot tell you.

## Afterwards

- The paired session persists in `BaileysSessionData` and resumes on the next
  `npm run worker` with no re-scan.
- To unpair: remove the linked device on the handset, then
  `DELETE FROM "BaileysSessionData" WHERE "channelId" = '<channelId>';` and set
  the channel back to `DISCONNECTED`.
- If the number gets banned, that is the expected end state, not a bug in this
  procedure. Get another throwaway number.
