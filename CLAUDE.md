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

### `KnowledgeBase`
Property-fact FAQs. Bot answers directly (no handoff) when parser classifies `general_info` into one of these `topic_key`s with confidence ≥ 0.7.
- `topic_key` (string, e.g. `pool_heated`, `sleeps`, `location`)
- `question_examples` (long text — comma-separated phrasings for parser prompt)
- `answer` (long text, supports `{name}` placeholder)
- `active` (checkbox)

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
  trigger the redirect template. Read by `BookingRulesService` on every
  validation.
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
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

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
```

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
