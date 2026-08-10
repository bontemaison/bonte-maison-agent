# TODO — Bonté Maison WhatsApp Automation

Read this before starting any phase. Updated as work progresses.

---

## Done

### Planning & docs
- [x] Technical approach doc (client-facing)
- [x] Conversation flows doc (11 scenarios, 9 user journeys)
- [x] CLAUDE.md — original Phase 0 scope
- [x] CLAUDE.md — updated with all 8 phases, Airtable schema, parser output spec, booking rules
- [x] `.claude/project-summary.md` — full project overview, build order, open questions
- [x] `.claude/template-scripts.md` — all ~40 template keys, ~70 variant rows, in Jim's voice (no sign-off name)
- [x] `scripts/seed-templates.ts` — Airtable seed script with real template content, idempotent upsert

---

## Open questions (block on these before the affected phase)

Resolve with Jim before building the relevant phase:

| # | Question | Blocks |
|---|---|---|
| 1 | SuperControl integration method — IMAP or webhook? | Phase 6 |
| 2 | Pricing edge case — stay spanning two seasonal bands: check-in date's band? | Phase 1 |
| 3 | Long stay threshold — strictly monthly, or any stay >3 weeks in Oct-May? | Phase 1 |
| 4 | Jim's notification channel — WhatsApp to personal number, or email? | Phase 5 |
| 5 | Hold conflict — second enquirer asks about held dates: "unavailable" or "provisionally held"? | Phase 2 |
| 6 | Instant book timing — build toggle now in Phase 0, or defer to Phase 6? | Phase 6 |
| 7 | Airtable access — shared base or Jim owns it from day one? | Phase 0 |

---

## Phases

Build in this order — each phase should be fully working and tested before moving on.

---

### Phase 0 — Foundation
> Get a bot that can handle a basic enquiry end-to-end. Nothing skipped.

- [x] **Logger service** (`src/logger/`)
  - Colored output by module tag
  - Levels: debug / info / warn / error
  - Debug suppressed in production
- [x] **Airtable service** (`src/airtable/`)
  - Base client wrapper
  - Read + write methods
  - All SDK access goes through here — never import Airtable directly elsewhere
- [x] **iCal availability** (`src/availability/`)
  - Fetch iCal feed (HTTP, fresh per request)
  - Parse events
  - `isAvailable(checkIn, checkOut)` function
  - Edge cases: empty feed, overlapping events, all-day vs timed events
- [x] **Pricing calculator** (`src/pricing/`)
  - Fetch seasonal bands from Airtable `Pricing` table
  - `getQuote(checkIn, checkOut)` → weekly rate × number of weeks
  - Handle multi-band spans (use check-in band until Q2 confirmed)
- [x] **Template service** (`src/templates/`)
  - Fetch template by key from Airtable `Templates` table
  - Variable substitution (`{name}`, `{check_in}`, etc.)
  - Variant rotation (cycle or random)
- [x] **Claude parser** (`src/parser/`)
  - Send raw WhatsApp message to Claude Haiku 4.5
  - Extract structured JSON: intent, dates, guest count, name, email, flags
  - Handle malformed JSON response gracefully
  - Prompt caching on system prompt
- [x] **WhatsApp webhook** (`src/whatsapp/`)
  - GET verification endpoint (`WHATSAPP_VERIFY_TOKEN`)
  - POST message handler — unauthenticated by design; Meta signs with
    Dualhook's app secret, which we cannot obtain
  - Always return 200 (retry protection)
- [x] **WhatsApp sender** (`src/whatsapp/`)
  - `sendMessage(to, text)` via WhatsApp Business API
  - Log every send to `MessageLog`
  - Check conversation pause state before sending
  - Retry on 429
- [x] **Conversation state** (`src/conversation/`)
  - Read/write `Conversations` table (pause status, last activity)
  - Command parsing: `/release`, `/pause`, `/resume`
  - Auto-pause when Jim replies manually (detect outbound human message)
  - Auto-resume after 24h silence from Jim
- [x] **Orchestrator** (`src/orchestrator/` or `MessageHandlerService`)
  - Wire everything together
  - Incoming message → parse → route by intent → reply
  - Holding reply + notify Jim on unhandled errors
- [x] **Phase 0 tests**
  - Unit test every service with mocked dependencies
  - Edge cases: empty iCal, missing pricing band, Claude returns malformed JSON, WhatsApp 429
  - Signature verification test
  - Pause state tests (bot stays silent when paused)

---

### Phase 1 — Booking rules & enhanced pricing
> Enforce property-specific constraints before pricing/availability runs.

- [x] **Booking rules module** (`src/booking-rules/`)
  - Sunday check-in validation → suggest nearest Sunday
  - Sunday check-out validation
  - 7-night minimum enforcement → suggest full week
  - Weekly blocks only (7 / 14 / 21 nights)
  - 2026 fully-booked redirect (configurable via `BookingRules.year_2026_fully_booked`)
  - Oct–May long stay detection → flag for manual pricing
  - Discount request detection → flag + notify Jim
- [x] **Seasonal pricing bands**
  - Multi-row schema in Airtable `Pricing` table
  - Pricing service reads correct band by date
- [x] **Phase 1 tests**
  - Non-Sunday dates → correct suggestion returned
  - Sub-7-night stay → correct alternative returned
  - 2026 dates → redirect fired
  - Oct–May long stay → manual flag set, no quote generated
  - Discount request → notify flag set
- [x] **Fixed template variable names** throughout orchestrator (`check_in`, `check_out`, `price`, `name`, `month`, `suggested_check_in`, `suggested_check_out`)
- [x] **Added `mentionsDiscount` + `highIntentSignal`** to parser output

---

### Phase 2 — Hold system
> 5-day date hold with automated reminders and release.

- [x] **Airtable `Holds` table** — create schema (phone, check_in, check_out, hold_created_at, hold_expires_at, reminder_sent, status)
- [x] **HoldsService** (`src/holds/`)
  - Create hold
  - Check if dates are held by anyone (treat as unavailable to others)
  - Mark hold as converted / cancelled
- [x] **Hold offer** — append to quote reply when high intent or explicitly requested
- [x] **Hold acceptance flow** — parse "yes hold those dates" intent → create hold → send confirmation
- [x] **Hold expiry cron** (node-cron, daily)
  - Find holds expiring today → send reminder (day 4)
  - Find holds past expiry → auto-release + send expiry message
- [x] **Phase 2 tests**
  - Hold created correctly with 5-day expiry
  - Held dates treated as unavailable for second enquirer
  - Reminder sent at day 4, not before/after
  - Auto-release fires and message sent
  - Hold converted when booking confirmed

---

### Phase 3 — Follow-up sequences
> Automated 24h + 7d follow-ups for non-responding enquirers.

- [x] **Airtable `Conversations` follow-up fields** — `follow_up_24h_sent`, `follow_up_7d_sent`, `follow_up_count`
- [x] **Follow-up scheduler** (node-cron, hourly or daily)
  - Find enquiries with no reply + no booking + 24h elapsed → send 24h nudge
  - Find enquiries with no reply + no booking + 7d elapsed → send 7d nudge
  - Mark sent flags after each send
- [x] **Cancel logic** — if customer replies or books, clear pending follow-ups
- [x] **Phase 3 tests**
  - 24h nudge fires at right time, not before
  - 7d nudge fires, 24h not re-sent
  - Reply from customer cancels sequence
  - Booking cancels sequence
  - Already-sent flags prevent double sends

---

### Phase 4 — CRM expansion
> Full guest record for status tracking and follow-up eligibility.

- [x] **Expand `Conversations` schema** (guest_name, email, status enum, dates_requested, price_quoted, availability_result, last_intent, follow_up fields)
- [x] **Update all handlers** to write CRM fields on each interaction
- [x] **Status transitions**: New → Responded → Follow-up → Booked / Lost
- [x] **Phase 4 tests**
  - Each intent updates the correct CRM fields
  - Status transitions fire correctly
  - Price/dates fields updated on each quote

---

### Phase 5 — Notifications to Jim
> Escalation channel for anything the bot can't handle. Two channels: WhatsApp + email, both optional, fire on every channel that's set.

- [x] **Notifications module** (`src/notifications/`)
  - `NotificationsService.notifyOwner(text, context?)` — fans out to WhatsApp + email
  - `EmailService` — Nodemailer SMTP transport (no-op when SMTP envs unset)
  - Envs: `OWNER_PHONE`, `OWNER_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  - Fail-safe: failure on one channel logged, never crashes main flow
- [x] **Wire escalation triggers** in orchestrator:
  - Uncertain / off-topic (`unclear_handoff`)
  - Outside knowledge base (`faq_unknown`)
  - Discount request (`discount_request`)
  - Long stay manual pricing (`long_stay_manual_pricing`)
  - Complaint / frustration (`complaint`)
  - Human request (`human_request`)
  - Booking confirmation (`booking_confirmation`)
  - Hold conflict (`hold_conflict`) — second enquirer hits held dates
  - Unavailable dates (`dates_unavailable`) — so Jim can offer alternatives
  - Orchestrator error (`orchestrator_error`) — includes the error message
  - Unmatched SuperControl guest — wired in Phase 6
- [x] **Phase 5 tests**
  - `src/notifications/notifications.service.spec.ts` — both channels, single channel, neither, partial failure
  - `test/e2e/scenarios/18-notifications.spec.ts` — handoff fans out, discount/unavailable/hold-conflict/error reasons

---

### Phase 6 — SuperControl email integration & instant book toggle
> Send WhatsApp nudges when SuperControl emails go out, and swap the booking flow once SuperControl instant book is live.

*Blocked on open questions #1 (IMAP vs webhook) and #6 (instant book timing).*

**Email integration**

- [ ] **Email ingestion** — IMAP monitoring OR webhook endpoint (decide with Jim first)
- [ ] **Email parser** — classify email type: booking_confirmation / directions / pre_arrival / mid_stay / thank_you / review_request
- [ ] **Guest matcher** — match email recipient address → `Conversations` record by email field
- [ ] **Nudge trigger** — select correct nudge template, send via WhatsApp, dedup check
- [ ] **Safety rule** — do not send if guest cannot be confidently matched (notify Jim instead)

**Instant book toggle**

- [x] **`instant_book_enabled` BookingRules flag** — read in orchestrator
- [x] **Swap template**: `booking_confirmed_handoff` → `booking_confirmed_instant_book` when flag is true

**Phase 6 tests**

- [ ] Each email type maps to correct nudge template
- [ ] Unmatched guest → no message sent, Jim notified
- [ ] Duplicate email event → no double send
- [ ] All 6 nudge types tested end-to-end
- [ ] Instant book flag false → email-ask template used
- [ ] Instant book flag true → website-link template used

---

## Things not to forget

- `BookingRules.year_2026_fully_booked=true` is a runtime flag — make it easy to flip when dates open up for 2027 planning
- Test Claude parsing edge cases: "early August", "next week", "around Christmas", relative dates
- Test iCal edge cases: overlapping events, all-day vs timed, empty feed, feed HTTP error
- WhatsApp 24-hour messaging window — check if nudges on older conversations violate the policy
- `POST /webhook` is open to anyone who learns the URL — HMAC verification is impossible under Dualhook's Webhook Override. If this becomes a concern, add a secret URL path segment and/or an IP allowlist for Meta's webhook ranges
- Seed script (`npm run seed:templates`) must be run against the live Airtable base before first deployment
- Follow-ups must cancel when customer replies (check across all intent types, not just booking)
- `booking_confirmed_handoff` → swap to instant book variant when Jim flips the switch
- Shadow mode / test number for Phase 0 rollout before pointing at real guest traffic
