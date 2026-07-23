# Customer Data Management — Architecture Review

Status: **DESIGN REVIEW ONLY. No code, no migrations.** Answers the 10 questions directly; refines (not replaces) `audit/CUSTOMER_DATA_MANAGEMENT_MARKETING_HUB_DESIGN.md` where the reasoning here leads somewhere more specific — flagged inline where that happens. Production remains the source of truth; nothing here is final until the outstanding verification is back.

---

## 1. Customer Lifecycle

**No — not every customer should be forced through "Lead."** A hotel guest who stayed last year and is being bulk-imported today was never a sales inquiry; modeling them as `status = 'new_inquiry'` and marching them through a pipeline they never entered is a category error, not just an inconvenience — it corrupts every pipeline metric (conversion rate, average time-to-close) that assumes `status` means "where in the sales process."

Recommended model: keep the single-table architecture (Section 1 of the prior document is unchanged — still no parallel `customers` table), but recognize the record has **two independent axes**, not one:

- **Origin** — how the record entered the system. Already modeled by `source` (website/whatsapp/instagram/justdial/referral/other/proposal, soon `customer_import`) plus the proposed `imported_from_customer_import` flag.
- **Lifecycle stage** — where the relationship stands. Today this is entirely `status`, which is pipeline-shaped (`new_inquiry → followup_pending → proposal_sent → negotiation → confirmed/rejected`). That's correct for organic leads and should stay untouched for them.

For bulk-imported records, recommend one additive `status` value: **`'customer'`** — meaning "this is a known customer with no active sales process," entered directly, skipping the pipeline entirely. This keeps every existing pipeline query correct by construction (a report on "active pipeline" just excludes `'customer'` the same way it already excludes `'confirmed'`/`'rejected'`), while giving bulk-imported records an honest status instead of a fabricated pipeline stage. A lead can still transition from pipeline stages into `'customer'` on conversion if that's ever wanted later — this doesn't foreclose that, it just stops forcing the reverse.

---

## 2. Customer Identity

Current reality, confirmed from code: `resolveIdentity()` already treats **phone as primary, email as secondary/ambiguous** — phone match returns with confidence, email match is explicitly flagged (`hasConflictingIdentifier`) rather than trusted outright. That's the right instinct for this business (WhatsApp-first, Kolkata hospitality market, where phone is the more universally collected and more stable identifier than email).

Trade-offs on your four options:

- **Phone only** — simplest, matches how the business actually operates (every WhatsApp campaign needs one anyway). Risk: shared phones (a family or corporate booking made via one person's number) and number recycling (Indian telecom reassigns inactive numbers, typically ~90 days) can both cause incorrect identity merges over a long enough timeline.
- **Email only** — not viable as primary here; too many real leads have no email at all (walk-ins, phone inquiries), and it's demonstrably less reliable in this dataset than phone.
- **Phone + Email (OR-matching with confidence ranking)** — what the code already does. Pragmatic, no schema change needed, correctly reflects that phone is more trustworthy without discarding email entirely.
- **Multiple phones / multiple emails (identity graph)** — the textbook 5-year-scale answer (this is what Salesforce/HubSpot do: a `contact_identifiers` table, many rows per customer, each typed and flagged primary/verified). Real, not over-engineering in the abstract — but there's no evidence yet that this business has the specific problem it solves (customers routinely reachable on more than one number/email). Building it now would be schema investment against a need that hasn't shown up.

**Recommendation:** keep single `phone`/`email` columns as primary identity for now (phone primary, email secondary — formalizing what `resolveIdentity()` already does), and treat a `customer_identifiers` table as a **Category C (future roadmap)** item, built only if/when multi-identifier cases actually appear in the data (e.g. corporate clients who book via an assistant's number but also have a personal number on file). This is additive whenever it happens — not a redesign — so deferring it costs nothing.

One concrete near-term action this section does justify: **verify (Section 2 of the earlier document) whether `leads.phone` has a real UNIQUE constraint, and if not, add one.** Everything above — and every duplicate-prevention claim already made in this codebase — depends on phone actually being unique. This is foundational, not optional, and it's cheap.

---

## 3. Marketing-Ready Schema Across Channels

Design principle: model consent, preferred channel, and engagement history in **channel-agnostic shapes now**, even though only WhatsApp is implemented, so email/SMS arrive as new values and new rows — not new columns or new redesigns.

Concretely:

- **Consent** — per-channel, not a single flag (full reasoning in Section 5 below; this supersedes the single `marketing_consent` field proposed in the prior document).
- **Preferred channel** — already proposed (`preferred_channel` enum including `'email'`, `'sms'`), channel-agnostic by construction.
- **Engagement history** — today, `whatsapp_last_message_at` is the only "last contact" signal, and it's WhatsApp-specific. Recommend a generic `last_engagement_at` + `last_engagement_channel` pair (Section 9 covers why this is worth adding now vs. later).
- **Message logs** — `whatsapp_messages` already exists and works. For email/SMS, the natural extension is either parallel tables or a shared discriminated table. Worth knowing before choosing either: `012_v3_foundation_schema.sql` already designed (but never applied) a `unified_messages`/`unified_conversations` schema for exactly this — a channel-agnostic message log. When email/SMS sending actually gets built, align with that existing design rather than inventing a third pattern; two competing "generic message log" schemas in one codebase is worse than either alone.
- **Campaign delivery** — `broadcast_campaigns.channel` is already `CHECK (channel IN ('whatsapp','email','both'))`. Adding `'sms'` later is a one-line additive constraint change, not a redesign.
- **Scoring/AI** — `lead_score`, `ai_score`, `ai_score_reason`, `lead_temperature`, `booking_probability` already exist and are channel-agnostic by nature (they score the person, not a channel interaction).
- **Loyalty** — nothing exists yet (`lifetime_value` and `repeat_customer` are adjacent but not the same thing as a points/tier system). Recommend deferring actual loyalty columns until that feature is scoped — adding empty `loyalty_points`/`loyalty_tier` columns now, with no feature consuming them, is the kind of speculative addition Section 9 argues against.

---

## 4. Tags vs. `campaign_tags`

Checked actual usage rather than inferring from the migration alone:

- **`tags`** (migration 001) is live and actively used — but currently **overloaded**. `src/lib/lead-scorer.ts` merges system-auto-generated tags (`HOT`/`WARM`/`COLD`, `URGENT`, `FOLLOW_UP`, `VIP`, `WEDDING`, `CORPORATE`, `LARGE_EVENT` — all computed automatically on every scoring pass) into the *same array* as whatever else might be in there, with no marker distinguishing "the scorer put this here" from "a human typed this here."
- **`campaign_tags`** (migration 003) has **zero references anywhere in `src/`** — it's a dead column today, not an active dual-purpose system as its name might suggest.

Given that: don't merge them. Recommend the opposite of merging — **use this as the natural boundary that's currently missing inside `tags` itself**:

- `tags` stays exactly as-is (system-computed, lead-scoring output — don't touch working code for this feature).
- `campaign_tags`, currently dead, gets **revived** for its apparent original purpose: user-curated, marketing-specific labels an admin deliberately applies for segmentation and list-building (e.g. `"diwali_2026_invitee"`, `"vip_repeat_customer"`, `"wedding_2025_guest"`) — distinct from the auto-managed temperature/urgency tags in `tags`.

This is a genuinely low-risk move: no schema change (the column already exists live per the migration), just a new, documented usage convention plus the tags-editor UI writing to `campaign_tags` instead of `tags`. It also directly avoids a real bug class: building a segment/audience filter on top of `tags` today would silently include or exclude people based on their *current* lead temperature (which changes automatically), not any marketing-relevant property — using `campaign_tags` for marketing segmentation avoids that trap entirely.

---

## 5. Marketing Consent — refines the earlier single-field proposal

The earlier document proposed one tri-state `marketing_consent` field. Reconsidering with the specific question asked (single field vs. per-channel):

**Per-channel is the correct long-term design**, and this revises the earlier recommendation. Reasoning:

- Consent is legally and practically channel-specific — someone can reasonably want WhatsApp updates but not email, or vice versa. A single flag can't represent that, and would need per-channel reinterpretation the moment a second channel launches anyway, which defeats the point of adding it now.
- The existing `whatsapp_opted_in BOOLEAN` is already a per-channel signal, just an inconsistent one (Section 3 of the earlier document details the inconsistency across `campaigns.ts` vs. `cron/followups/route.ts`). A per-channel *tri-state* design is the natural, non-disruptive evolution of what's already there, rather than a competing concept.

Recommended shape:

```
whatsapp_consent  TEXT DEFAULT 'unknown' CHECK (whatsapp_consent IN ('yes','no','unknown'))
email_consent     TEXT DEFAULT 'unknown' CHECK (email_consent  IN ('yes','no','unknown'))
sms_consent       TEXT DEFAULT 'unknown' CHECK (sms_consent    IN ('yes','no','unknown'))
```

`'unknown'` matters as a real third state, not a placeholder — a bulk-imported hotel guest was never asked, and that's legally and practically different from someone who was asked and said no. Collapsing "never asked" into "no" undercounts a genuinely reachable audience; collapsing it into "yes" is a compliance risk.

Migration path for the existing `whatsapp_opted_in` boolean: don't repurpose it in place (five-plus live call sites depend on its current boolean meaning). Add `whatsapp_consent` alongside it, backfill `whatsapp_consent = 'yes'` where `whatsapp_opted_in = true` and `'unknown'` elsewhere, then migrate call sites over one at a time, then deprecate the boolean once nothing reads it. This is a Category B item (needed before the marketing module scales, not needed today) specifically because it touches live, working code paths and deserves its own careful sequencing — not because it's low-value.

A derived, read-only `has_any_consent` view or computed field (`whatsapp_consent = 'yes' OR email_consent = 'yes' OR sms_consent = 'yes'`) covers the "quick filter" use case the single-field design was originally solving, without losing per-channel precision.

---

## 6. Customer Lists — both, plus one addition

Recommend **both**, because they answer different questions:

- **Dynamic (saved segment/filter)** — right for criteria that should always reflect current data: "everyone with a birthday this month," "all VIP leads in Kolkata." No manual maintenance; membership changes as data changes. This is what `broadcast_campaigns.segment` already models.
- **Static (explicit membership — `customer_lists`)** — right for curated or ledger-style sets that must *not* silently drift: a hand-picked VIP list, the guest list from a specific past event, a list built from one import batch that should stay exactly what it was at import time.

**One addition worth designing in now rather than retrofitting later:** the ability to **snapshot a dynamic segment into a static list.** This is a standard, high-value CRM pattern — build a segment, review the count, then freeze it before sending so the recipient list can't shift between preview and actual send. Concretely: `customer_lists` gets an optional `source_segment JSONB` column (nullable) recording what filter it was frozen from, for reference/audit, while membership itself (`customer_list_members`) stays static once created either way. Cheap to include in the same migration as the base tables (Category B), expensive to bolt on after the fact.

---

## 7. Bulk Import Workflow — gaps in the proposed flow

Working through the stated flow (Upload → Preview → Column Mapping → Validation → Duplicate Resolution → Import → Audit Log) for real failure modes, six things are missing:

1. **Import traceability on the customer record itself.** Nothing today links a `leads` row back to the `lead_imports` batch that created it — there's no `leads.imported_via_import_id`. Without it, "show me everyone from import #47" or "undo import #47" is impossible after the fact, which directly undercuts the audit-log step's usefulness. Cheap addition (one nullable FK column), high value, recommend Category A.
2. **Duplicate-resolution preview before commit.** The flow shows Duplicate Resolution → Import as one step; for 10,000+ rows, the resolution *strategy* (skip/update/merge) should be chosen and its *effect previewed* (counts, sample rows) before anything is written — not applied blindly across the whole file. Otherwise "merge missing information" run against a bad column mapping silently corrupts thousands of existing records with no chance to catch it first.
3. **Consent defaults on import, made explicit to the admin.** A bulk-imported hotel guest was never asked about marketing. The wizard must default every imported record to `'unknown'` consent (never infer `'yes'` from "they stayed at our hotel") and should say so visibly during the wizard, not just as a backend default — this is as much a UX/compliance safeguard as a schema rule.
4. **Resume/retry for partial failures on large files.** If a large import times out or fails partway (a real risk given the current 30s serverless ceiling, per the earlier document's Section 6), there's no way to resume from where it stopped without risking duplicate rows on re-upload. Needed once background processing (Category B/C, per the earlier doc) is built — flagging here so it's designed in from the start rather than retrofitted.
5. **Completion notification for async/background imports.** Once large imports move off the synchronous request/response path, the admin needs to be told when it's actually done — a background job with no completion signal just looks like it silently vanished.
6. **A "review before commit" sample, not just a 50-row preview.** The spec's Step 2 previews the raw file; recommend the wizard also show a *post-mapping, post-validation* sample right before commit (a handful of fully-transformed rows, exactly as they'll be written) — catches column-mapping mistakes that only become visible after mapping, not before.

---

## 8. Campaign Architecture

Recommended pipeline, addressing a real gap in what exists today:

```
Customer (leads)
   ↓
Segment (JSONB filter, e.g. broadcast_campaigns.segment) OR static Customer List
   ↓
Campaign (broadcast_campaigns row — name, channel, template, status)
   ↓
Recipients ← NEW: campaign_recipients table
   ↓
Delivery (channel-specific send: sendBroadcastCampaign() today, future email/SMS equivalents)
   ↓
Analytics (rolled up FROM campaign_recipients, not hand-incremented counters)
```

**The gap:** today, `POST /api/campaigns` (`action=send`) re-runs `buildSegment(campaign.segment)` **at send time**, not at campaign-creation time. Whatever you previewed when building the campaign isn't necessarily who actually receives it — if a lead's status/city/tags change between creation and send, the recipient list silently drifts. `sent_count`/`failed_count`/`reply_count` on `broadcast_campaigns` are also hand-incremented aggregate counters, not derived from anything queryable per-recipient — you can't currently ask "who specifically didn't get this campaign" or "retry just the failed ones."

**Recommendation:** a `campaign_recipients` table (`campaign_id`, `lead_id`, `channel`, `status` [pending/sent/delivered/failed/skipped_no_consent], `sent_at`, `delivered_at`, `failed_reason`, `whatsapp_message_id` or future equivalent) populated **once, when the campaign is created** (freezing the recipient list, same snapshot principle as Section 6's list design) rather than recomputed at send. This makes the pipeline channel-agnostic by construction — WhatsApp/email/SMS delivery all write to the same table with a different `channel` value — and makes analytics a query over real per-recipient data instead of trusted counters. This is the single most valuable concrete addition in this review for the "scalable for WhatsApp, Email and future SMS" goal specifically, and it's additive (new table, references existing `broadcast_campaigns` and `leads`, changes nothing that exists today).

---

## 9. AI Readiness

Existing foundation is already good: `lead_score`, `ai_score`, `ai_score_reason`, `ai_scored_at`, `lead_temperature`, `urgency_level`, `booking_probability`, `is_vip`, `lifetime_value`, `repeat_customer` all already exist and are reusable as-is.

**Recommend adding, with genuine now-value (not speculative):**

- `last_engagement_at TIMESTAMPTZ` + `last_engagement_channel TEXT` — generic, channel-agnostic versions of what `whatsapp_last_message_at` only partially covers today. Directly useful for any future re-engagement/churn feature regardless of which channel eventually sends the message, and cheap to add now versus retrofitting a generic column after three channel-specific ones already exist.

**Recommend explicitly *not* adding, per "only long-term value" instruction — these are outputs of models that don't exist yet:**

- `churn_risk_score`, `next_best_action`, `data_quality_score` and similar — adding empty placeholder columns for a future model's output before that model is designed is the over-engineering trap this question is guarding against. When that AI feature is actually built, its output storage should be designed alongside the model that produces it, informed by what the model actually needs — not guessed at now.
- `preferred_event_type` as a stored column — this is *derivable* from booking/inquiry history once that data exists in volume, not a fact to store redundantly on the customer record. Storing it invites drift between the stored value and the actual history the moment someone's preferences change.
- `communication_history` as a column — the message logs (`whatsapp_messages`, and the future channel-agnostic log from Section 3) already *are* this; a future AI feature reads from there, it doesn't need a denormalized summary column maintained in parallel.

---

## 10. Final Architecture Assessment

### A. Implement Immediately
- Verify (and if missing, add) a real UNIQUE constraint on `leads.phone` — foundational to every duplicate-prevention claim already made in this codebase.
- `leads.imported_via_import_id` (nullable FK to `lead_imports`) — cheap, closes the traceability/rollback gap in Section 7.
- `leads.imported_from_customer_import BOOLEAN` + `'customer_import'` source value — supports the lifecycle model in Section 1.
- New `'customer'` status value on `leads_status_check` — the lifecycle fix from Section 1.
- `last_engagement_at` / `last_engagement_channel` — cheap, genuinely useful, Section 9.
- Document the `tags` vs `campaign_tags` responsibility split (Section 4) — a decision/documentation change, not necessarily even a migration, since `campaign_tags` already exists.
- Resolve the still-outstanding migration 017 verification — unchanged from every prior message in this thread.

### B. Implement Before Marketing Module
- Per-channel consent columns (`whatsapp_consent`/`email_consent`/`sms_consent`) + migration path off the existing `whatsapp_opted_in` boolean (Section 5).
- `campaign_recipients` table (Section 8) — needed before campaign volume scales, since it's what makes delivery and analytics trustworthy.
- Consolidate the two existing WhatsApp send implementations and close the opt-out/STOP handling gap (both carried over from the earlier document, still unresolved, both genuinely block safe scale-up).
- `customer_lists` / `customer_list_members` + segment-snapshot capability (Section 6).
- The remaining `leads` columns from the earlier document (company/city/state/country/address/date_of_visit/birthday/anniversary/preferred_channel).
- Import wizard's column-mapping table, duplicate-resolution preview, and consent-defaults-to-unknown safeguard (Section 7).
- Extend `buildSegment()`'s filter set.

### C. Future Roadmap
- `customer_identifiers` table for multi-phone/multi-email identity — only if/when real multi-identifier cases show up in the data (Section 2).
- Email and SMS sending infrastructure — data model is being made ready for it now; the sending mechanics, deliverability, and channel-specific compliance are a separate future initiative.
- Loyalty points/tier schema — once the loyalty feature itself is scoped.
- Aligning future channel-agnostic message logging with the already-designed-but-unapplied `unified_conversations`/`unified_messages` schema from migration 012, rather than building a third parallel pattern.
- AI-driven segmentation UI — the underlying data model (JSONB segments, `campaign_recipients`) already supports it without further schema change.

### D. Do Not Implement
- A separate, parallel `customers` table — reopens a settled 2026-07-13 architectural decision and contradicts the explicit instruction to reuse the Leads architecture.
- Speculative AI-output columns (`churn_risk_score`, `next_best_action`, `data_quality_score`) before the models producing them exist (Section 9).
- `preferred_event_type` as a stored, denormalized column (Section 9) — derive it from history instead.
- Merging `tags` and `campaign_tags` into one column (Section 4) — they should stay separate; the fix is enforcing the boundary that's currently missing, not erasing it.
- Building the multi-identifier identity graph now, ahead of demonstrated need (Section 2) — real future value, wrong time.

---

## Open items

1. Production verification (`audit/PRODUCTION_VERIFICATION_LEADS.sql`) — still the actual blocker before any Category A migration gets written.
2. Confirm the `'customer'` status value (Section 1) and the tags/`campaign_tags` split (Section 4) match your intent before they're written into a migration — both are judgment calls this review is making on your behalf and worth a quick yes/no.
