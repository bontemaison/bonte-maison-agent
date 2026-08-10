# CLAUDE.md

Context and conventions for building the **Bonté Maison WhatsApp Automation** project.

> **Status legend:**
> ✅ = Implemented / planned in original scope and still valid
> 🟡 = Partially covered, needs expansion
> 🔴 = New scope, not yet implemented
> ⚠️ = Needs client clarification before building

---

## Project overview

WhatsApp automation for **Bonté Maison**, a premium rental property near Duras, France. Owned by Jim. Single property, English-speaking guests.

**Core behavior:** Customer sends WhatsApp → bot parses intent/dates with Claude → checks iCal availability → looks up pricing in Airtable → replies using pre-approved templates in Jim's voice. Bot nudges toward booking, offers 5-day date holds, runs follow-up sequences, and sends short WhatsApp nudges when SuperControl emails are sent.

---

## Stack

- **Runtime:** Node.js + Nest.js (monorepo, single app)
- **Language:** TypeScript (strict mode)
- **Hosting:** Railway
- **Data:**
  - Airtable — pricing, templates, conversations (CRM), holds, message log, follow-up queue
  - iCal feed — availability (fetched fresh per inquiry)
- **External APIs:**
  - WhatsApp Business API (direct, not Twilio)
  - Anthropic Claude API (Haiku 4.5 for parsing)
  - SuperControl — email ingestion (method TBD — IMAP or webhook) ⚠️
- **Testing:** Jest + TDD
- **Jobs:** node-cron for background tasks (hold expiries, follow-ups)

---

## Architecture principles

- **Templates, not LLM-generated replies.** Claude parses. Templates reply. Never let Claude freestyle customer-facing copy.
- **Backend orchestrates, Airtable stores.** No chained Airtable automations.
- **Fail safe toward the human.** Uncertain = holding reply + notify Jim + pause.
- **Premium tone throughout.** Warm, confident, quietly persuasive. Never pushy.
- **Bot nudges toward booking.** After answering questions, conversion hooks ("happy to hold dates for you while you decide?").

---

## Module structure

```
src/
├── whatsapp/          # WhatsApp Business API client, webhook handler, send logic
├── parser/            # Claude integration, intent classification, date/entity extraction
├── availability/      # iCal fetching + parsing, date range checks
├── pricing/           # Seasonal pricing bands, quote calculation, long-stay detection
├── templates/         # Airtable template fetching, variable substitution, variant rotation
├── knowledge-base/    # Property-fact FAQs (pool, sleeps, location, etc.) — answered by bot, not handed off
├── conversation/      # Conversation state, handoff logic, command parsing
├── holds/             # 🔴 5-day hold system + expiry scheduler
├── guests/            # Guest recognition — Guests table + journey mode resolution
├── follow-ups/        # 🔴 24h + 7d follow-up sequences
├── email-integration/ # 🔴 SuperControl email ingestion + nudge triggering
├── notifications/     # 🔴 Jim escalation channel (WhatsApp to Jim's number)
├── booking-rules/     # 🔴 Sunday changeover, 7-night minimum, 2026 blackout, etc.
├── airtable/          # Shared Airtable client (all Airtable access goes through here)
├── logger/            # Categorized colored logging
└── app.module.ts
```

---

## Conventions

### Airtable access
All Airtable ops go through `AirtableService`. Never import Airtable SDK directly in feature modules.

### WhatsApp sending
All outbound messages through `WhatsappService.sendMessage()`. Logs every send, respects pause state, handles retries.

Session sends wait a human-like typing delay scaled by reply length (50ms/char, clamped 2–10s — constants in `whatsapp.service.ts`) so replies don't feel instant/robotic. `sendTemplate` (HSM, owner notifications) sends immediately.

### Dualhook (outbound relay)
Production runs `WHATSAPP_PROVIDER=dualhook`. Dualhook relays outbound Cloud API
requests — the payload, path and API version are unchanged; only the host and
the bearer differ. `CloudApiProvider` resolves both at construction:

| provider | host | bearer |
|---|---|---|
| `cloud_api` | `graph.facebook.com` | `WHATSAPP_ACCESS_TOKEN` |
| `dualhook` | `api.dualhook.com` | `DUALHOOK_LIVE_KEY` (`dh_live_...`) |

The `dh_live_` key is server-side only — never sent to Meta, never in client
code. Inbound webhooks are **not** relayed: they still arrive directly from
Meta, so signature handling (`WHATSAPP_SKIP_SIGNATURE_CHECK`,
`WHATSAPP_APP_SECRET`) is unaffected by this setting.

### Dates & timezones
Booking dates are **calendar dates, not instants** — "2 May 2027" is a day.
Every one is anchored at UTC midnight. All helpers live in `src/common/dates.ts`
(`parseIsoDate`, `formatIsoDate`, `nextSunday`, `startOfUtcDay`, `addDays`,
`DAY_MS`) — never build a booking date with a bare `new Date(...)` elsewhere.

The SuperControl iCal feed emits **floating** datetimes (`DTSTART:20270509T000000`
— no `Z`, no `TZID`), which node-ical resolves in the *server's* local zone. On
UTC+7 that read 9 May as `2027-05-08T17:00Z`, so every booking bled into the
preceding week and free weeks reported as unavailable. `AvailabilityService`
re-anchors each event via `floatingDateToUtc` on ingest, which is correct on any
server timezone. If the feed ever starts sending zoned values, the event is left
as parsed and a warning is logged.

`TZ=UTC` is set in env and `cron.schedule` is pinned to UTC as belt-and-braces,
but the code must not *depend* on either. Guard with `npm run test:tz`, which
runs the suite under Asia/Jakarta, America/Los_Angeles and UTC. Test fixtures for
iCal events must model node-ical's output — **local** midnight, not UTC midnight
(see `floatingLocalMidnight` in `availability.service.spec.ts`).

Airtable: `check_in`/`check_out` are date-only strings — keep "include time" off.
`hold_expires_at`/`hold_created_at` are true instants, written via `toISOString()`.

### Phone numbers
The canonical form is **digits only, no leading `+`** (`447901857452`) — exactly
what Meta puts in `wa_id`, and what every `phone` column already holds
(`Conversations`, `Holds`, `MessageLog`, `Guests`, `OWNER_PHONE`). Helpers live
in `src/common/phone.ts`:

- `normalizePhone(raw, defaultCc = DEFAULT_COUNTRY_CODE)` — handles `07…`,
  `+44…`, `0044…`, punctuation, and the `+44 (0)7435…` trunk-prefix form.
  Returns `null` for anything unusable; callers log and skip rather than
  writing a number that can never match.
- `formatE164(phone)` — display only, for owner notifications. **Nothing writes
  a `+` to Airtable.**

Numbers from SuperControl emails and numbers from the webhook both go through
`normalizePhone` before they are compared, so format differences can never cause
a missed recognition.

### Guest recognition & journey modes
`GuestsService.resolveContext(phone)` runs on every inbound message and returns
one of five modes. **Stay status is derived at lookup** against today's date, so
a guest moves future → current → past with no edit in Airtable.

Resolution order — a paid booking outranks a speculative hold:

1. booking with `check_in <= today <= check_out` → `current_guest`
   (arrival *and* departure day both count as in-stay)
2. soonest booking with `check_in > today` → `future_guest`
3. `HoldsService.getActiveHoldForPhone` → `hold`
4. any booking with `check_out < today` → `past_guest`
5. otherwise → `prospect`

`resolveContext` **never throws** — an Airtable failure logs and returns
`prospect`, which is the pre-recognition behaviour. A message is never dropped
because recognition was unavailable.

The orchestrator changes by **context injection, not routing**: the prospect
funnel is untouched. For any mode other than `prospect`, `buildCompositionPackage`
adds two facts — `guest_context` (the structured record) and
`guest_mode_guidance` (tone rules for that stage). For `future_guest` and
`current_guest` only (`CONFIRMED_GUEST_MODES` in `message-handler.service.ts`)
three guardrails also apply: `needsNudgeToBook` is forced false, the
`www.bontemaison.com` link is not appended, and `followUps.schedule` is skipped.
A guest on a hold, or a past guest asking about a return visit, is still being
sold to and keeps all three.

Nothing financial ever reaches the composer — `ParsedBooking` has no field for
it (see below).

### Holds: expiry is derived, never read from `status`
A hold is expired the instant `hold_expires_at` passes. The `status` column is a
**cache for Jim's CRM view**, reconciled afterwards by the cron — it is never the
source of truth. Read paths (`hasOverlap`, `getActiveHoldForPhone`) call
`isLapsed()`; checking `status` alone let a lapsed hold block bookings until the
next cron tick.

`HoldsCronService` runs every 15 minutes (holds expire at `created + 5 days`, i.e.
at whatever minute the guest asked — a daily tick missed its own window by up to
24h). Both notify branches **claim before sending** — write `status`/
`reminder_sent` first, then send. At this cadence, notifying first would re-send
to the guest 96×/day if a status write failed. Losing one message to a failed
send is the accepted trade; the error is logged.

### Logging
Use `LoggerService`, not `console.log`. Every log specifies module tag + level:

```ts
logger.info('whatsapp', 'Received message from +62...');
logger.warn('parser', 'Claude returned unexpected format', { raw });
logger.error('pricing', 'Missing pricing band for date', { date });
```

Colors:
- `whatsapp` → cyan
- `parser` → magenta
- `availability` → blue
- `pricing` → yellow
- `templates` → green
- `conversation` → white
- `holds` → bright yellow
- `guests` → bright white
- `follow-ups` → bright blue
- `email-integration` → bright magenta
- `notifications` → bright green
- `booking-rules` → bright cyan
- `knowledge-base` → bright yellow
- `airtable` → gray
- `error` → red (overrides)

### Error handling
- Webhook always returns 200 (WhatsApp retries aggressively on non-200).
- Errors inside processing → log + holding reply + notify Jim.
- No silent failures.

### Tone rules (enforced in templates)
- Use **"reserved"** not "sold" or "taken"
- Warm, premium, human
- Confident but not pushy
- Gently guide toward booking
- Sign off as **Jim**, include **www.bontemaison.com** where appropriate
- Vary sign-offs: "Thanks", "Thank you", "Kind regards", "Many thanks"

---

## Development approach

### TDD workflow
Write failing test → minimal code → refactor → move on.

### Incremental build order

> Status: original plan covered Phase 0. Phases 1-7 are new scope from Jim's updated requirements.

#### ✅ Phase 0 — Foundation (originally planned, not yet built)
1. Logger service
2. Airtable service (base client)
3. iCal parser + availability check
4. Pricing calculator (basic)
5. Template service
6. Claude parser
7. WhatsApp webhook + sender
8. Conversation state + pause/resume commands
9. Basic orchestration (MessageHandler)

#### 🔴 Phase 1 — Booking rules & enhanced pricing
10. Booking rules module (Sunday changeover, 7-night minimum enforcement, weekly blocks 1-2-3 weeks)
11. Seasonal pricing bands (multi-band schema in Airtable)
12. 2026 fully-booked redirect rule
13. Long-stay detection (Oct-May) → manual pricing flag
14. Discount request detection → flag + notify Jim

#### 🔴 Phase 2 — Hold system
15. Holds table in Airtable
16. "Offer to hold" after quote scenarios
17. Hold acceptance flow
18. Hold expiry cron (daily check)
19. Reminder before expiry (day 4)
20. Auto-release on expiry
21. Bot awareness: if dates held by someone else, treat as unavailable

#### 🔴 Phase 3 — Follow-up sequences
22. Follow-up queue table in Airtable
23. Scheduler: detect enquiries with no reply + no booking
24. 24-hour follow-up send
25. 7-day follow-up send
26. Cancel sequence if customer replies or books

#### 🔴 Phase 4 — CRM expansion
27. Expand Conversations schema (name, email, price_quoted, status enum, follow_up_count, etc.)
28. Every handler updates CRM fields
29. Status transitions: New → Responded → Follow-up → Booked / Lost

#### SuperControl email — what actually arrives
SuperControl does **not** send from `bookings@bontemaison.com`. It relays through
Mandrill, which rewrites the envelope sender:

```
From:     "Bonte holiday home in France"
          <bookings=bontemaison.com@secure-booking-email.net>
Reply-To: bookings@bontemaison.com
```

Only the `Reply-To` carries the friendly address, so both forms are allowlisted
in `SUPERCONTROL_CONFIG.senderEmails`. `SUPERCONTROL_EXTRA_SENDERS` still adds
more at runtime. A real example lives at `resources/booking-confirmed.eml`.

There are **nine** email types, not eight. Eight nudge subjects map to a
`NudgeKey` and fire a WhatsApp template. The ninth —
`BOOKING_RECORD_SUBJECT` (`"Deposit paid for your holiday at Bonte"`) — is the
one that carries the guest's phone number. It writes a `Guests` row and sends
**nothing**; it never reaches the nudge dispatcher. Note it is distinct from
`nudge_booking_confirmation` ("Your Stay at Bonté is Confirmed"), which
SuperControl sends later once the balance is paid.

`booking-email.parser.ts` parses the decoded `text/plain` part (HTML as
fallback). The raw MIME part is quoted-printable and breaks words across lines,
so it **must** go through `simpleParser` before any regex touches it. Three
traps, all covered by the spec:

- Jim signs every email with `+44 (0)7435 301 371`, so the phone regex is
  anchored on `Tel:` — an unanchored search stores the owner's number.
- `Booking date:` sits directly above `Arrival date:` with the identical date
  shape, so the date anchors are label-bound.
- `Guests:` straddles a line break (`Adults: 4\nChildren: 2 Infants: 2`).

**`ParsedBooking` has no field for money.** The property total, deposit,
balance, masked card PAN and payment link all collapse into the same paragraph
as the arrival/departure rows, so nothing financial is captured and none of it
can reach Airtable or the composer.

A booking with no phone number is still written (Jim adds the number by hand)
and Jim is notified — dropping the record would lose the whole booking.

#### 🔴 Phase 5 — SuperControl email integration
30. Email ingestion method (IMAP monitoring OR webhook — TBD ⚠️)
31. Email parser (identify type: booking confirmation / arrival / pre-arrival / mid-stay / thank you / review)
32. Guest matcher (match email recipient → WhatsApp conversation)
33. Nudge trigger logic + dedup
34. "Do not send if guest cannot be confidently matched" rule

#### 🔴 Phase 6 — Notifications to Jim
35. Notification channel setup (WhatsApp to Jim's number — assuming this by default)
36. Wire escalation triggers: uncertain, outside KB, discount, long stay, hold conflicts, unmatched guest

#### 🔴 Phase 7 — Instant book toggle
37. Config flag `instant_book_enabled` in `BookingRules`
38. Swap `booking_confirmed_handoff` variant based on flag
39. When Jim flips the switch post-SuperControl setup: bot redirects to website

---

### Testing rules
- Mock all external services in unit tests
- `*.spec.ts` colocated with source
- Test edge cases: empty iCal, missing pricing band, Claude malformed JSON, WhatsApp API 429, expired holds on boot, duplicate email events
- No integration tests against real APIs in CI

---

## Airtable schema

### `Pricing`
- `label` (string, e.g. `High Summer 2027`)
- `start_date` (date)
- `end_date` (date)
- `weekly_rate` (currency)
- `min_weeks` (number)

### `Templates`
- `key` (string, e.g. `availability_yes_quote`)
- `variant` (number)
- `text` (long text, with `{placeholders}`)
- `active` (checkbox)

### `Conversations` (CRM)
- `phone` (string, primary)
- `guest_name` (string)
- `email` (string)
- `status` (enum: `New | Responded | Follow-up | Booked | Lost`)
- `pause_status` (enum: `bot | human | paused`)
- `pause_until` (datetime)
- `dates_requested` (string — most recent)
- `price_quoted` (currency — most recent)
- `availability_result` (string — most recent)
- `last_intent` (string)
- `last_activity` (datetime)
- `follow_up_count` (number)
- `follow_up_24h_sent` (checkbox)
- `follow_up_7d_sent` (checkbox)
- `enquiry_source` (string)
- `notes` (long text — Jim's manual notes)

### `Holds` 🔴
- `phone` (string, linked to Conversations)
- `check_in` (date)
- `check_out` (date)
- `hold_created_at` (datetime)
- `hold_expires_at` (datetime — hold_created_at + 5 days)
- `reminder_sent` (checkbox)
- `status` (enum: `active | expired | converted | cancelled`)

### `Guests`
**One record per booking** — repeat guests get multiple rows, and that *is* the
stay history (no separate preference store). Written by the booking-email parser
and by `npm run backfill:guests`; upserted on `booking_ref` so replays are safe.
- `booking_ref` (string, primary — the upsert key)
- `phone` (string, normalised, no `+` — the lookup index)
- `phone_raw` (string — as it appeared in the email, for debugging a bad parse)
- `guest_name`, `email` (string)
- `check_in`, `check_out` (date — **date-only**, "include time" off)
- `adults`, `children`, `infants` (number)
- `property` (string), `source` (`supercontrol_email | backfill | manual`)
- `created_at` (datetime — true instant)

Jim's columns, **never written by the parser** so a re-parse can't wipe them:
- `dogs` (number — not in the booking email, entered by hand)
- `cot_or_highchair` (checkbox)
- `preferences` (long text — restaurants/vineyards mentioned positively)
- `operational_notes` (long text — passed to the composer verbatim)

There is no stay-status column: it is derived at lookup (see above).

### `KnowledgeBase`
Property-fact FAQs. Bot answers directly (no handoff) when parser classifies `general_info` into one of these `topic_key`s with confidence ≥ 0.7.
- `topic_key` (string, e.g. `pool_heated`, `sleeps`, `location`)
- `question_examples` (long text — comma-separated phrasings for parser prompt)
- `answer` (long text, supports `{name}` placeholder)
- `audience` (single select — see below; blank reads as `all`)
- `active` (checkbox)

`audience` gates who may be told the answer, and is how sensitive operational
detail (WiFi password, door codes) stays out of a prospect's reply:

| value | visible to |
|---|---|
| `all` | everyone, including a cold prospect (the default) |
| `pre_stay` | future guests and in-house guests |
| `in_stay` | in-house guests only |
| `sensitive` | in-house guests only, and kept out of any shared document |

`audiencesForMode()` in `knowledge-base.service.ts` maps a `GuestMode` to the
allowed set. The gate applies to `listTopics` as well as `render`: if a
prospect's parser never learns `wifi_password` exists, it can never ask for it,
so the answer can never be fetched by mistake.

### `MessageLog`
- `phone`
- `direction` (`in | out`)
- `text`
- `intent` (parsed, if direction=in)
- `template_key` (if direction=out)
- `timestamp`

### `BookingRules` 🔴
Simple key-value config for rules that change:
- `key`
- `value`
- `active`

Recognised keys:
- `year_2026_fully_booked` (`"true"` / `"false"`) — when `true`, 2026 dates
  trigger the redirect template — but only when the iCal agrees. Since Jim's
  2026-07 feedback the calendar wins over a stale flag: if the asked week /
  month actually shows free weeks in the iCal, the bot lists/quotes them and
  logs a warning instead of redirecting. Read by `BookingRulesService` on
  every validation (checked after the date-shape rules, so a redirect result
  always carries valid Sunday dates).
- `instant_book_enabled` (`"true"` / `"false"`) — when `true`, booking-
  confirmation replies use the instant-book variant. Read via
  `BookingRulesService.isInstantBookEnabled()`.
- `bot_paused_global` (`"true"` / `"false"`) — global kill-switch. When
  `"true"`, `ConversationService.canSendBot` returns false for every phone,
  so no template is sent and no composer reply is dispatched. Inbound messages
  are still logged. Toggled via `/pause` and `/resume` from `OWNER_PHONE` (no
  argument), or by editing the row directly in Airtable.
- `owner_notify_phone_enabled` (`"true"` / `"false"`) — when `true`, owner
  WhatsApp notifications fire to the `OWNER_PHONE` env recipient. Set to
  `false` to silence WA pings without removing the env var. Defaults to
  enabled if the row is missing.
- `owner_notify_email_enabled` (`"true"` / `"false"`) — same shape for email
  notifications (recipient is `OWNER_EMAIL` env). Defaults to enabled.

All keys can be flipped in Airtable without a redeploy. Run
`npm run seed:booking-rules` to create any missing rows with safe defaults
(existing values are preserved).

### Owner WhatsApp notification template
Owner WhatsApp notifications go through `sendTemplate` (HSM), not
`sendMessage`. This is because Jim might not have messaged the bot recently —
session sends fail outside the WhatsApp 24-hour customer-service window.

The template name lives in `OWNER_WHATSAPP_TEMPLATE`. The template must be
pre-approved at the WhatsApp provider (Wati/Meta) and accept a single body
parameter `{{1}}` that carries the full notification text. Example body:

```
🔔 Bonté Maison alert

{{1}}
```

If `OWNER_WHATSAPP_TEMPLATE` is unset, WhatsApp delivery is skipped (with a
warning) — email still fires if configured.

### Owner commands
Sent from `OWNER_PHONE` to the business number. Messages from any other
number are ignored. All commands route through `MessageHandlerService.runOwnerCommand`.

- `/pause` — global pause ON (writes BookingRules.bot_paused_global = true).
- `/pause <phone> [minutes]` — pause one conversation (optionally with TTL).
- `/resume` — global pause OFF.
- `/resume <phone>` — un-pause one conversation (sets pause_status back to bot).
- `/release <phone>` — mark one conversation as `human` (handed over to Jim).
  Requires a phone argument.
- `/status` — global state + counts of conversations in each pause_status.
- `/status <phone>` — per-conversation state.

### Human takeover (WhatsApp coexistence)
When Jim replies in a customer thread from the business number's WhatsApp app
(coexistence mode), WATI surfaces it as an `owner=true` webhook. The flow:

1. `WatiProvider.parseOutboundEcho` recognises the echo (separate from
   `parseWebhook` which still returns null for owner events).
2. `WebhookController` looks up the message id in `WhatsappService.wasRecentlySentByBot`.
   - Hit → the bot itself sent this; ignore.
   - Miss → it's Jim replying directly. Call
     `MessageHandlerService.handleOwnerTakeover(echo.to)` to set the
     conversation's `pause_status = human` **with a `pause_until` window**
     (`TAKEOVER_WINDOW_MIN`) and cancel any scheduled follow-ups.
3. The CloudAPI provider does not implement `parseOutboundEcho` — this flow is
   WATI-specific.

**Auto-resume.** A takeover is temporary: the bot stands back down only until
`pause_until` lapses. `ConversationService.resolveStatus` treats an expired
`pause_until` as `bot` (so the read path — `canSendBot` etc. — resumes the
instant the window ends), and `ConversationCronService` runs every minute to
call `resumeExpired()`, which writes `pause_status` back to `bot` and clears
`pause_until` in Airtable so the CRM view matches. `TAKEOVER_WINDOW_MIN` lives
in `message-handler.service.ts` — **currently 1 minute for testing; restore to
60 for production.** A manual `/release` sets `human` with *no* `pause_until`,
so it never auto-resumes — that handover stays with Jim until he `/resume`s.

---

## Environment variables

```
# WhatsApp Business API
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=      # unused when WHATSAPP_PROVIDER=dualhook
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
WHATSAPP_PROVIDER=          # cloud_api | dualhook | wati
DUALHOOK_LIVE_KEY=          # dh_live_... — required when provider is dualhook

# Airtable
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=

# Anthropic
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-haiku-4-5-20251001

# iCal
ICAL_URL=https://ical.promotemyplace.com/4ee2e6e0bce533ec4edd08202ce80eb9/calendar.ics

# Owner notifications (Phase 5)
# Both channels are optional; notifications fire on every channel that is set.
# Each channel can also be overridden in Airtable BookingRules
# (owner_notify_phone / owner_notify_email) — env values here are the fallback.
OWNER_PHONE=                # default WhatsApp recipient + identifies owner for /pause /release /resume /status commands
OWNER_EMAIL=                # default SMTP recipient
OWNER_WHATSAPP_TEMPLATE=    # pre-approved WhatsApp template name (HSM) used for owner WA pings — required for outside-24h delivery

# SMTP — only required if OWNER_EMAIL is set
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=          # defaults to SMTP_USER if unset

# SuperControl email integration (TBD method)
SUPERCONTROL_IMAP_HOST=
SUPERCONTROL_IMAP_USER=
SUPERCONTROL_IMAP_PASS=
# OR (if webhook):
SUPERCONTROL_WEBHOOK_SECRET=

# Feature flags
# instant_book_enabled and year_2026_fully_booked are stored as rows in the
# Airtable BookingRules table — no env var, toggle in Airtable.

# Response mode
RESPONSE_MODE=template
CLAUDE_RESPONSE_MODEL=claude-sonnet-4-6

# App
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
TZ=UTC                  # pin the process timezone — see "Dates & timezones"
DEFAULT_COUNTRY_CODE=44 # used by normalizePhone for national-format numbers
```

## Backfill

`npm run backfill:guests` populates the `Guests` table from historical
SuperControl booking emails, so the CRM isn't empty on day one. It scans the
**whole** mailbox (not just unseen), parses each booking email with the same
parser the live watcher uses, upserts on `booking_ref`, and seeds a
`Conversations` row per guest (lifecycle `Booked` for future/current stays).

It **never marks mail `\Seen`, never sends a WhatsApp message and never
schedules a follow-up**, and is dry-run by default:

```
npm run backfill:guests                # prints what it would write
npm run backfill:guests -- --commit    # actually writes
npm run backfill:guests -- --limit 20  # newest 20 matches only
```

Services are wired by hand in the script rather than via `NestFactory` —
booting `AppModule` would also start the live email watcher and every cron.

---

## Claude parser output (reference)

Claude classifies intent and extracts entities per incoming message. Expected JSON output:

```json
{
  "intent": "availability_inquiry | pricing_inquiry | greeting | general_info | booking_confirmation | hold_request | discount_request | human_request | complaint_or_frustration | off_topic_or_unclear",
  "check_in_date": "YYYY-MM-DD | null",
  "check_out_date": "YYYY-MM-DD | null",
  "nights": "number | null",
  "guest_count": "number | null",
  "guest_name": "string | null",
  "guest_email": "string | null",
  "mentions_dogs": "boolean",
  "mentions_discount": "boolean",
  "high_intent_signal": "boolean",
  "confidence": "high | low",
  "notes": "string — disambiguation context"
}
```

`high_intent_signal` = true when message suggests booking readiness ("this looks great", multiple questions, "we'd like to come", etc.) → triggers hold offer in reply.

---

## Booking rules (validation logic)

Enforced in `booking-rules/` module before pricing/availability:

1. **Check-in must be Sunday.** If not → suggest nearest Sunday.
2. **Check-out must be Sunday.** Duration in multiples of 7 (1, 2, or 3 weeks).
3. **Minimum 7 nights.** Fewer → offer 7-night alternative.
4. **2026 dates → redirect to 2027.** (Use iCal to suggest actual 2027 availability.)
5. **Oct–May + long stay (>3 weeks or monthly):** flag manual pricing, do not auto-quote.
6. **Stay spans two pricing bands:** use the band containing the check-in date. ⚠️ *Assumed, needs client confirmation.*
7. **Partial dates** ("4/5 days over April 23rd, flexible"): the orchestrator
   resolves the Sunday-to-Sunday week containing the target plus the following
   week, checks both against holds + iCal, and composes from those pre-checked
   facts (`partial_dates` scenario). The composer never invents dates; if both
   weeks are reserved the guest is told so and Jim is notified.

---

## What NOT to do

- **No LLM-generated customer replies.** Ever.
- **No chained Airtable automations.**
- **No in-memory state.** Railway restarts will wipe it.
- **No skipping tests.**
- **No `console.log`.** Use LoggerService.
- **No bypassing AirtableService / WhatsappService.**
- **No proactive discount offers.** Bot never suggests a discount.
- **No alternative-date suggestions when unavailable.** Jim handles those.
- **No sending WhatsApp to unmatched guests** in SuperControl integration.
- **No overengineering.** Bare minimum first.

---

## Out of scope (confirmed)

- Multiple properties
- Taking payments
- Non-English languages
- Complaint resolution (hand off only)
- Admin dashboard / UI
- Compound responses (multi-intent stitching)
- 48-hour follow-up (explicitly removed by client)

---

## Open questions ⚠️

1. **SuperControl integration method** — IMAP monitoring or webhook?
2. **Pricing band edge case** — stay spanning two bands: which rate? (Assumed: check-in date's band.)
3. **Long stay threshold** — strictly monthly (1-6 months) or any stay >3 weeks in Oct-May?
4. **Jim's notification channel** — assumed WhatsApp to his personal number. Confirm?
5. **Hold vs. real booking conflict** — assumed bot says "unavailable" to a second enquirer when dates are held by another. Confirm?
