# BookMySpaces CRM V3 — Domain Architecture & ADR (v1.0)

Status: **REFERENCE ARCHITECTURE. Design only — no code, no migrations.** Consolidates and supersedes nothing on its own; it is the summary record of the decisions made across `audit/CUSTOMER_BULK_IMPORT_MARKETING_DB_DESIGN.md`, `audit/CUSTOMER_DATA_MANAGEMENT_MARKETING_HUB_DESIGN.md`, `audit/CUSTOMER_DATA_ARCHITECTURE_REVIEW.md`, `audit/CUSTOMER_LIFECYCLE_REDESIGN.md`, and `audit/PIPELINE_STATUS_NULL_VS_VALUE_VS_ENTITY.md`. This is the one to hand a new engineer.

All schema described here remains provisional until the still-outstanding production verification (`audit/PRODUCTION_VERIFICATION_LEADS.sql`) is back — this document describes the target design, not a claim about what's live today.

---

## Part 1 — Domain Entities

A DDD pass surfaces one correction to the entity list worth stating up front: **Lead and Customer are not separate entities.** They are values of one entity's `lifecycle_stage` attribute. Modeling them as distinct entities is exactly the mistake the "no parallel customers table" decision (migration 012, 2026-07-13) already avoided — this section makes that explicit rather than leaving it implicit.

Similarly, **Segment is not an entity — it's a Value Object** (an immutable filter definition, no persistent identity of its own). Customer List *is* an entity (persistent identity, mutable membership). Both distinctions matter for how future code should be organized, not just terminology.

### Contact (aggregate root — physically `leads`; the table name is a historical artifact, not the domain concept)

- **Purpose:** the single, permanent source of truth for a person or organization's identity and relationship with the business, independent of how they entered or where they currently stand.
- **Owner:** Contact Management context. Only this context writes identity fields (`name`/`phone`/`email`) and `lifecycle_stage` directly; every other context references Contact by ID, never mutates its core identity.
- **Lifecycle:** created once — via organic inquiry, bulk import, proposal creation, or WhatsApp-initiated contact — and persists indefinitely (no deletion in the current design). `lifecycle_stage` moves `lead → customer`, one-directional in the common case.
- **Relationships:** referenced by Opportunity (embedded as `status` in v1, separate entity in v2), Proposal (1:many), WhatsApp Conversation (1:many), Campaign (many:many via Campaign Recipients), Import Job (many Contacts reference one Import Job — a *reference*, not an aggregate-ownership relationship: Contacts outlive the Import Job that created them), Customer List (many:many).
- **Future extensibility:** could grow a `customer_identifiers` child collection (multi-phone/multi-email) without changing its role as aggregate root (deferred per `CUSTOMER_DATA_ARCHITECTURE_REVIEW.md` Section 2, no evidenced need yet). Could later split into `Individual`/`Organization` subtypes if true multi-person corporate accounts become a requirement — flagged as a real possible fork, not designed now.

### Lead — not a separate entity
`Contact` where `lifecycle_stage = 'lead'`. No independent identity, storage, or lifecycle beyond the Contact it's a state of.

### Customer — not a separate entity
`Contact` where `lifecycle_stage = 'customer'`. Same as above.

### Opportunity (v1: embedded attribute; v2: first-class entity — see Part 2/3)

- **Purpose:** represents one trackable sales process for a Contact — today, this is the `status` field directly on Contact (`new_inquiry → ... → confirmed/rejected/future_prospect`, soon including `'no_active_pipeline'`).
- **Owner:** Sales Pipeline context.
- **Lifecycle:** the existing `status` enum, unchanged by this review.
- **Relationships (v1):** embedded 1:1 in Contact — a structural ceiling, not a design choice (a Contact can represent only one current opportunity, ever).
- **Future extensibility:** the entire point of the v2 extraction (Part 3) — decoupling from Contact so multiple concurrent or sequential opportunities per Contact become representable.

### Campaign (first-class entity — `broadcast_campaigns`)

- **Purpose:** one outbound marketing effort — targeting definition, channel, content, and results.
- **Owner:** Marketing context.
- **Lifecycle:** `draft → scheduled → running → completed/failed` (existing enum).
- **Relationships:** 1 Campaign : many Campaign Recipients (proposed owned child collection, `CUSTOMER_DATA_ARCHITECTURE_REVIEW.md` Section 8); references a Segment (value object) or Customer List (entity) for targeting.
- **Future extensibility:** already multi-channel-shaped (`channel IN ('whatsapp','email','both')`, additive for `'sms'`); A/B variants and recurring campaign series (e.g. an "automated birthday campaign" is really a template that spawns per-recipient sends on a schedule, not a single Campaign row) are a real future modeling question, intentionally not resolved here.

### Segment — Value Object, not an entity

- **Purpose:** an immutable, re-evaluated filter definition (`broadcast_campaigns.segment` JSONB) describing *criteria*, not a persisted set of specific people.
- **Owner:** Marketing context, embedded within Campaign — has no independent identity today.
- **Lifecycle:** created and evaluated at campaign-creation/preview time (recommended to freeze into Campaign Recipients at creation, not re-evaluated at send time — see `CUSTOMER_DATA_ARCHITECTURE_REVIEW.md` Section 8).
- **Future extensibility (v2):** promotable to a first-class, named, reusable entity once more than one Campaign needs the same definition (Part 3).

### Customer List (entity — proposed, not yet built)

- **Purpose:** a named, persistent, explicitly-curated set of specific Contacts — distinct from a Segment because membership doesn't silently change as data changes.
- **Owner:** Marketing context.
- **Lifecycle:** created (manually curated, or as a frozen snapshot of a Segment) → membership changes over time (manual lists) or stays fixed (snapshots) → referenced by 0-many Campaigns.
- **Relationships:** many:many with Contact via `customer_list_members`.
- **Future extensibility:** "smart lists" that auto-refresh on a schedule — a deliberate hybrid of Segment and List — flagged as future, not designed now.

### Import Job (entity — `lead_imports`)

- **Purpose:** one bulk-import execution — file, column mapping used, and outcome — the record that makes bulk-created Contacts traceable and auditable.
- **Owner:** Data Import context.
- **Lifecycle:** `pending → processing → completed/failed` (existing enum).
- **Relationships:** one Import Job references many Contacts it created/updated (via the proposed `leads.imported_via_import_id`) — a *reference*, not aggregate ownership; Contacts belong to Contact Management, not Data Import, even though Data Import created them.
- **Future extensibility:** resumable/retryable large imports need a row-level child (`import_job_rows`) for partial-failure tracking (`CUSTOMER_BULK_IMPORT_MARKETING_DB_DESIGN.md` Section 6); scheduled/recurring imports (e.g. nightly PMS sync) are a plausible later addition.

### WhatsApp Conversation (entity — `conversations` / `whatsapp_conversations`)

- **Purpose:** one dialogue thread with a Contact over WhatsApp — the state machine driving the AI concierge, and the container for its Messages.
- **Owner:** Communication context.
- **Lifecycle:** `NEW_INQUIRY → WAITING_FOR_EVENT_TYPE → ... → QUALIFIED/HANDOFF_TO_OPERATOR` (existing state machine, migration 009).
- **Relationships:** many Conversations : 1 Contact (a Contact can have multiple threads over time); 1 Conversation : many Messages (owned children within the aggregate).
- **Future extensibility:** this is exactly what migration 012's not-yet-applied `unified_conversations`/`unified_messages`/`channels` design already anticipated — generalizing to Email/SMS threads under one shape. Target architecture (Part 3) adopts that existing design rather than re-deriving a new one.

### Proposal (entity — `proposals`)

- **Purpose:** a specific priced offer sent to a Contact for a specific event.
- **Owner:** Commerce/Booking context (a boundary judgment call — could reasonably sit under Sales Pipeline instead; noted as a call, not a fact).
- **Lifecycle:** `draft → sent → viewed → accepted/rejected → expired` (existing enum, migration 003).
- **Relationships (v1):** many Proposals : 1 Contact, referencing today's single embedded Opportunity implicitly via the Contact's `status`. **(v2):** Proposal references Opportunity directly — closes the loop between Commerce and Sales Pipeline once Opportunity is a real entity.
- **Future extensibility:** proposal versioning/revisions; multi-proposal comparison for a single opportunity.

---

## Part 2 — Bounded Contexts

Grouping the entities above clarifies *why* certain data lives where it does:

| Context | Owns | References |
|---|---|---|
| Contact Management | Contact (identity, `lifecycle_stage`, consent, tags) | — |
| Sales Pipeline | Opportunity (embedded in v1; own aggregate in v2) | Contact |
| Data Import | Import Job | Contact (creates/updates, doesn't own) |
| Communication | WhatsApp Conversation, Messages | Contact |
| Marketing | Campaign, Campaign Recipients, Segment, Customer List | Contact, Opportunity (targeting criteria) |
| Commerce/Booking | Proposal, (future) Booking/Reservation | Contact, Opportunity (v2) |

Contact is the only entity every other context depends on — which is exactly why the "extend Contact, don't fork it" decision (ADR-001) is load-bearing for the whole model, not just a Customers-module detail.

---

## Part 3 — Current, Transitional, and Target Architecture

### 1. Current Architecture (v1) — what gets implemented now

- One core aggregate, **Contact**, physically the `leads` table, carrying identity, `lifecycle_stage` (new attribute: `lead`/`customer`), pipeline `status` (existing enum plus `'no_active_pipeline'`), consent (per-channel, new), and classification flags (`is_vip` — reused as-is, `is_corporate` — new, `repeat_customer` — existing column, needs application wiring).
- **Campaign**, **Import Job**, **WhatsApp Conversation**, and **Proposal** as separate first-class entities, each referencing Contact by ID — this part of the architecture is already correct and unchanged by this review.
- **No Opportunity entity** — still embedded as the `status` attribute on Contact.
- **No Customer List entity yet** — proposed, not yet built.
- **Segment** remains an ephemeral JSONB value embedded directly in Campaign, not independently reusable.
- **Tags** split: `tags` (system/AI-scoring-computed) vs. `campaign_tags` (revived for user-curated marketing labels) — two columns, two clearly separated responsibilities, no merge.

### 2. Transitional Architecture — intentional compromises, stated explicitly

Naming every deliberate "good enough for now" choice, so it reads as intentional to the next engineer, not accidental:

- **`status = 'no_active_pipeline'`** stands in for a Contact having no current sales process, on a field that will eventually move to a separate Opportunity entity entirely. This is a Contact-level attribute doing a job an independent aggregate should eventually do — accepted now because there's no evidenced need yet for concurrent opportunities per Contact (ADR-009).
- **`lifecycle_stage` is an attribute, not a sub-type.** `Lead` and `Customer` don't have their own behavior or invariants beyond the flag's value — correct and intentionally minimal for now, but worth knowing this is a simplification if, say, "Lead-only" validation rules ever need to diverge meaningfully from "Customer-only" ones.
- **Segment has no independent identity** — it lives only inside whichever Campaign embeds it. Customer List (once built) covers the *static* half of this gap; a *reusable, named, dynamic* segment definition, usable by multiple Campaigns without copy-pasting the filter, is still not modeled. Small, known gap, not an oversight.
- **`campaign_tags` reuse is a pragmatic choice, not a clean Tag entity.** A "proper" DDD Tag would have its own taxonomy/definition table; today it's a free-text array on Contact. Intentionally minimal per "smallest safe change," not a design accident.
- **`repeat_customer` is a data-quality compromise, not a schema one** — the column is correct, but nothing populates it yet; it needs an application-level trigger as part of implementation, not a followup someone forgets.
- **Communication context has only one implemented member (WhatsApp).** The schema is being kept *ready* for Email/SMS (channel-agnostic consent, `preferred_channel`) without those Conversation entities existing yet — deliberately deferred, not missed.

### 3. Target Architecture (v2) — 3-5 year evolution, no major redesign required

- **Opportunity becomes a first-class entity/aggregate**, decoupled from Contact — enables multiple concurrent or sequential opportunities per Contact.
- **Contact's `status` field is retired** in favor of Opportunity records; `lifecycle_stage` is unchanged (it was already correctly modeled in v1 — this is not a v2 change).
- **Communication context generalizes** to the already-designed (migration 012, not yet applied) `unified_conversations`/`unified_messages`/`channels` shape, covering WhatsApp/Email/SMS uniformly instead of one channel-specific table per channel.
- **Segment becomes a first-class, named, reusable entity**, usable by many Campaigns and convertible to a Customer List snapshot — replacing the embedded-JSONB-per-campaign approach.
- **Campaign gains Campaign Recipients as a real owned child collection**, replacing hand-incremented `sent_count`/`failed_count` counters with queryable per-recipient records.
- **Proposal references Opportunity directly**, closing the loop between Commerce and Sales Pipeline contexts.

### Migration path, v1 → v2 (staged — matches this project's established additive-first discipline)

1. **Introduce Opportunity as an additive table**, dual-write period: Contact's `status` and the new Opportunity record both updated together, nothing removed yet.
2. **Migrate read paths off `Contact.status` module by module** — kanban, hot-leads dashboard, dashboard stats, escalation engine, followup cron, and the other ~15 files already identified as `status`/`lead_stage` consumers this session — one at a time, not in one PR.
3. **Retire `Contact.status`** only once no reads remain — deprecate first, keep for one release as a safety net (matching the rollback discipline already used for every migration since 010), drop later.
4. **Promote Segment** to its own table once a second Campaign genuinely needs to reuse an existing filter definition — purely additive, doesn't touch any existing campaign.
5. **Adopt migration 012's `unified_conversations` schema** once Email or SMS sending is actually being built — not before. Building it "just in case" would repeat the exact speculative-schema mistake already flagged in `CUSTOMER_DATA_ARCHITECTURE_REVIEW.md` Section 9.

No step here requires a big-bang cutover or breaks a working code path mid-migration — each step is independently deployable, matching every migration this project has shipped safely so far (010, 016, 017 pattern).

---

## Part 4 — Architecture Decision Record

| # | Decision | Alternatives considered | Rejected because | Future trigger point |
|---|---|---|---|---|
| ADR-001 | No parallel `customers` table — Contact extends `leads` | Separate `customers` table with FK to `leads` | Reopens a settled 2026-07-13 Product Owner decision; the "Customers" module today is already just a search UI over `leads`, so a fork would need a sync mechanism between two tables holding the same identity — pure added risk for no capability gain | None identified — would need a concrete capability that genuinely can't live on Contact, not yet observed |
| ADR-002 | `lifecycle_stage` (lead/customer) as a Contact *attribute*, not a new entity/table | Separate `customer_type` classification table; multi-value tag-based classification | An attribute is sufficient while Lead/Customer have no independent behavior or invariants; a table would be premature structure for two values | If Lead-only or Customer-only validation/behavior genuinely diverges beyond a flag check |
| ADR-003 | Pipeline "no opportunity" state uses a dedicated `'no_active_pipeline'` status value, not `NULL` | `status = NULL`; immediate extraction to a separate Opportunity entity | NULL breaks the `.eq('status', x)` filter idiom used throughout the codebase and Postgres's three-valued logic silently excludes NULL from inequality filters — a correctness trap, not a style preference. Immediate Opportunity extraction is the right long-term shape but too large a change to justify before the simpler fix is even shipped | Superseded by ADR-009 once Opportunity ships as its own entity |
| ADR-004 | Field named `lifecycle_stage`, not `relationship_type` | `relationship_type`; `customer_type` | Lead→customer is a one-directional progression, not a static category — "stage" is the accurate term, and matches established CRM vocabulary (e.g. HubSpot's Lifecycle Stage) | None — naming decision, not schema-triggered |
| ADR-005 | `tags` (system/AI-computed) and `campaign_tags` (user-curated marketing labels) stay separate | Merge into one column; deprecate `campaign_tags`, add a new dedicated marketing-tags column | Verified via code search that they already serve different producers (`lead-scorer.ts` vs. intended manual admin use) — merging would let auto-generated temperature tags (HOT/COLD, which change constantly) leak into marketing segmentation criteria | If a formal tag taxonomy/hierarchy is ever needed, promote to a real Tag entity — not before |
| ADR-006 | Per-channel tri-state consent (`whatsapp_consent`/`email_consent`/`sms_consent`), not one `marketing_consent` flag | Single tri-state `marketing_consent`; keep `whatsapp_opted_in` boolean as-is, no new field | Consent is legally and practically channel-specific; a single flag would need per-channel reinterpretation the moment a second channel ships anyway | None — this is the terminal design for consent modeling |
| ADR-007 | `campaign_recipients` as an explicit owned child collection of Campaign | Recompute segment at send time (current behavior); hand-incremented aggregate counters only | Current behavior lets the recipient list silently drift between campaign creation and send, and prevents any per-recipient retry/analytics | Already justified today — recommended for the "Implement Before Marketing Module" tranche, not deferred |
| ADR-008 | Customer Lists support both dynamic (Segment) and static (List), with a snapshot capability between them | Dynamic-only; static-only | Real, different use cases (always-current criteria vs. frozen curated sets) that a single model can't serve well | None — both are needed as designed |
| ADR-009 | Defer Opportunity extraction (Contact→Opportunity split) to v2, not built now | Build Opportunity as a first-class entity immediately | No evidenced case yet of a Contact needing multiple concurrent opportunities; building it now would be speculative schema investment against an unconfirmed need, and the ~15-file blast radius makes it too large to justify pre-emptively | A repeat/corporate Contact genuinely needing two open opportunities tracked simultaneously becomes a recurring, not hypothetical, situation |
| ADR-010 | Defer multi-identifier Contact model (`customer_identifiers` table for multiple phones/emails) | Build the identifier table now, given it's asked about explicitly in the spec | No evidenced multi-identifier cases in the data yet; `resolveIdentity()`'s existing phone-primary/email-secondary approach already handles the common case | Multi-phone/multi-email cases (e.g. corporate clients reachable on more than one number) become a recurring, observed pattern |
| ADR-011 | No speculative AI-output columns (`churn_risk_score`, `next_best_action`, etc.) added ahead of the models producing them | Add placeholder columns now so "the schema is ready" for AI features | Columns for outputs of models that don't exist yet can't be validated against real requirements, and risk needing rework once the actual model is built | When a specific AI feature is scoped, design its output storage alongside that feature, not in advance of it |

---

## Standing precondition, restated once more

Every schema element in this document — column names, constraint shapes, the very existence of tables like `broadcast_campaigns`/`festival_calendar` this design assumes are live — remains provisional pending `audit/PRODUCTION_VERIFICATION_LEADS.sql`'s results. This document is the design to implement once that verification closes the loop, not a claim that any of it is already true in production.
