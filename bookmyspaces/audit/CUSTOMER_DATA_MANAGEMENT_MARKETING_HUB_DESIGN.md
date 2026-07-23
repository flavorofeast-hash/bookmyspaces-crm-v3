# Customer Data Management & Marketing Hub — Architecture Review

Status: **DESIGN ONLY. Nothing in this document has been implemented, migrated, or deployed.**

This extends `audit/CUSTOMER_BULK_IMPORT_MARKETING_DB_DESIGN.md` (prior session) into the specific structure requested here. It does not repeat that document's full code inventory — see that file for the line-by-line evidence (which files, which functions, which migrations) behind the claims below.

**Standing precondition, unchanged from every prior response in this thread:** the schema recommendations in this document are provisional. `audit/PRODUCTION_VERIFICATION_LEADS.sql` has been handed to you twice and its results haven't been pasted back yet. Every column/table/constraint proposal below is marked either "confirmed reusable" (verified from migration files + code, not schema-drift-sensitive) or "provisional" (depends on what the live constraint/column inventory actually shows). No migration gets written until that's in hand — this document is the design to react against once it is.

---

## 1. Architectural principle

Same as the prior document, restated because it governs every decision below: **extend `leads`, do not create a parallel `customers` table.** This is a confirmed Product Owner decision (`012_v3_foundation_schema.sql:40-44`, dated 2026-07-13), not a recommendation being made fresh here. The "Customers" module today is a search UI over `leads` with no independent storage. Every capability in your list of 12 is designed below as either a `leads` extension, a new table that references `leads(id)`, or a reuse of existing campaign infrastructure — never a second copy of customer identity.

---

## 2. Capability-by-capability status

| # | Capability | Current state | Design approach |
|---|---|---|---|
| 1 | Bulk Customer Import | Lead Import exists and was hardened this session, but is Excel/CSV → `leads` with a fixed column set, no mapping UI, no duplicate-resolution choices | Generalize the existing import pipeline (Section 3/5) |
| 2 | Customer Search | Live — `GET /api/leads?search=` (name/phone/email/event_type via `ilike`) | Extend filter set (Section 5), no new storage |
| 3 | Customer Segmentation | Live — `buildSegment()` in `src/lib/campaigns.ts` filters by status/source/score/event_type/venue/vip/recency | Extend filter set (Section 3) |
| 4 | Customer Tags | Live — `leads.tags TEXT[]` (migration 001) and `leads.campaign_tags` (migration 003, purpose currently undocumented — worth clarifying whether these two tag columns are meant to serve different purposes or are themselves a small piece of drift) | Reuse `tags`, clarify `campaign_tags` before building on it |
| 5 | Marketing Consent Management | Partial — `whatsapp_opted_in BOOLEAN` exists but is two-valued, WhatsApp-only, and used with inconsistent semantics across call sites (detailed in the prior doc, Section 3) | New tri-state `marketing_consent` field, `whatsapp_opted_in` left untouched |
| 6 | WhatsApp Marketing Campaigns | Live but split across two inconsistent implementations, one of which isn't Meta-compliant for cold sends | Consolidate onto the template-based path (Section 3) |
| 7 | Email Marketing Campaigns | Does not exist — no email-sending infrastructure found anywhere in `src/` | Data-model readiness only in this phase (Section 3); sending infrastructure is future work, out of scope here |
| 8 | Birthday & Anniversary Campaigns | Does not exist — no `birthday`/`anniversary` columns, no scheduled job for them | New columns + new cron route, following the existing `src/app/api/cron/followups/route.ts` pattern |
| 9 | Customer Lists | Does not exist as a first-class concept — `broadcast_campaigns.segment` is a filter definition (JSONB), not a saved static list of specific people | New table (Section 3) |
| 10 | Campaign History | Live — `broadcast_campaigns` (migration 004) + `GET /api/campaigns` — **provisional on Section 2's live-existence check**, since `SCHEMA_DRIFT_REPORT.md` lists it as defined-but-not-applied | Reuse as-is once confirmed live |
| 11 | Import History | Live — `lead_imports` (undocumented drift, confirmed live via `DATABASE_AUDIT.md`, actually used by `src/app/api/leads/import/route.ts` today) | Extend with 2 columns (Section 3) |
| 12 | AI Customer Segmentation (future) | Does not exist | No schema needed now — see Section 3's note on why the JSONB segment design already accommodates this later |

---

## 3. Proposed database design

### 3.1 `leads` — additive columns (provisional, pending live column list)

```
company              TEXT
city                 TEXT
state                TEXT
country              TEXT
address              TEXT
date_of_visit         DATE
birthday              DATE
anniversary           DATE
marketing_consent     TEXT DEFAULT 'unknown'
                      CHECK (marketing_consent IN ('yes','no','unknown'))
preferred_channel     TEXT
                      CHECK (preferred_channel IN ('whatsapp','email','sms','call','any'))
imported_from_customer_import BOOLEAN DEFAULT FALSE
```

Rationale for each: covers capabilities 1, 5, 8 directly. `imported_from_customer_import` exists so reporting can distinguish "came in via bulk import" from organic leads without overloading `source` (which is CHECK-constrained and already carries a different meaning — how the lead originally arrived, not how it entered this database).

Explicitly **not** proposed: renaming or repurposing `whatsapp_opted_in`. Five-plus live call sites depend on its current boolean semantics; reconciling it with the new tri-state `marketing_consent` is a deliberate follow-up, not something to bundle silently into this migration.

`leads_source_check` gets one more additive value, `'customer_import'`, parallel to `'excel_import'` — lets reporting tell the two import features apart. (This is a second, separate addition from whatever migration 017 turns out to need — see Section 4.)

### 3.2 New table: `customer_import_column_mappings`

Satisfies "mappings should be remembered for future imports" (capability 1).

```
id            UUID PRIMARY KEY
user_id       UUID  -- who saved it
mapping_name  TEXT  -- e.g. "Hotel PMS export"
column_map    JSONB -- {"Guest Name": "name", "Phone": "phone", ...}
created_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ
```

### 3.3 New tables: `customer_lists` + `customer_list_members`

Satisfies capability 9. A "list" is a static, named, manually-curated set of specific customers — distinct from a segment (which is a *live filter*, re-evaluated every time it's used, per `broadcast_campaigns.segment`). Both are legitimate and complementary: "everyone with `event_type = wedding`" is a segment; "the 40 guests from the Sharma wedding I want to re-target for their anniversary" is a list.

```
customer_lists:
  id           UUID PRIMARY KEY
  name         TEXT NOT NULL
  description  TEXT
  created_by   UUID
  created_at   TIMESTAMPTZ

customer_list_members:
  list_id      UUID REFERENCES customer_lists(id) ON DELETE CASCADE
  lead_id      UUID REFERENCES leads(id) ON DELETE CASCADE
  added_at     TIMESTAMPTZ
  PRIMARY KEY (list_id, lead_id)
```

### 3.4 `lead_imports` — additive columns

Satisfies capability 11 (already mostly live). Add:

```
updated_rows    INTEGER DEFAULT 0   -- rows that matched an existing customer and were updated/merged
duplicate_rows  INTEGER DEFAULT 0   -- rows skipped as duplicates
```

`total_rows`, `valid_rows`, `invalid_rows`, `status`, `error_log`, `imported_by`, `filename`, `created_at`, `completed_at` already exist and already cover the rest of the spec's audit-trail fields.

### 3.5 Campaign History — no new schema (capability 10)

`broadcast_campaigns` already has the right shape for this (segment definition, channel, template, sent/delivered/failed/reply counts). Nothing to add here beyond confirming it's actually live (Section 2 of the prior document).

### 3.6 Why AI Segmentation (capability 12) needs no schema today

`broadcast_campaigns.segment` and the proposed `customer_lists` are both storage-agnostic about *how* the member set was decided — a segment is just a JSONB filter, a list is just a set of `lead_id`s. An AI-driven segmentation feature later would populate a `customer_list` (or a new `segment` JSONB shape) the same way a human-built one does today; it doesn't need its own tables now. Flagging this explicitly so the current design isn't over-built for a future feature that doesn't have requirements yet — consistent with "implement the smallest safe changes."

---

## 4. Required migrations

**None are being written in this document.** What Section 3 implies, in migration-number order, once Section 2's verification is in hand:

- Whatever 017 turns out to be (see the still-open question: does production already have `'excel_import'`, or not) — resolved separately, not decided here.
- A new migration (018 or whatever the next free slot is, following this repo's convention of documenting gaps rather than guessing at a number) for: the `leads` columns in 3.1, the `'customer_import'` source value, `customer_import_column_mappings` (3.2), `customer_lists`/`customer_list_members` (3.3), and the two `lead_imports` columns (3.4).
- All `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`, following the same idempotent, additive, pre-flight/post-flight-commented pattern as every migration since 010. No existing column, constraint, or table is altered or dropped.
- RLS: new tables need policies before they're usable from a session-scoped client — following the pattern already established for `lead_imports` (`009:197-200`, authenticated-role full access) rather than inventing a new access model.

---

## 5. API changes

| Endpoint | Change | Capability |
|---|---|---|
| `POST /api/leads/import` (existing) | Superseded by a new wizard-shaped endpoint set, not modified in place — this route stays as the simple "just import, defaults only" path it is today (already fixed this session); the wizard is additive, not a rewrite of it | 1 |
| `POST /api/customers/import/preview` (new) | Parses a file, returns first 50 rows, no DB writes | 1 |
| `GET/POST /api/customers/import/mappings` (new) | List / save column-mapping presets | 1 |
| `POST /api/customers/import/commit` (new) | Runs the real import with a chosen mapping + duplicate-resolution mode (skip / update / merge / new) | 1 |
| `GET /api/leads` (existing) | Extend `search`/filter params to include city, tags, company (already selects `*`, so no new column exposure needed, just query params) | 2, 3 |
| `POST /api/segments/preview` (new, or extend `POST /api/campaigns` `action=preview`) | Extend `SegmentFilter` (currently status/source/score/event_type/venue/vip/recency) with city/state/country/tags/birthday-month/anniversary-month/marketing_consent/lead_owner | 3 |
| `GET/POST/DELETE /api/customer-lists` (new) | CRUD for lists; `POST /api/customer-lists/[id]/members` to add/remove | 9 |
| `PATCH /api/leads/[id]` (existing, via `updateLeadSchema`) | Add `marketing_consent`, `preferred_channel`, `tags` to the allow-list | 4, 5 |
| `GET /api/campaigns` (existing) | No change needed once confirmed live | 10 |
| `GET /api/leads/import` (existing) | Extend response with `updated_rows`/`duplicate_rows` once 3.4 lands | 11 |
| Birthday/anniversary cron (new) | `src/app/api/cron/birthday-wishes/route.ts`, following the exact shape of `src/app/api/cron/followups/route.ts` — daily query for `birthday`/`anniversary` matching today's month+day, `marketing_consent = 'yes'` gate, send via the consolidated template path (Section 6 of the prior doc) | 8 |

No endpoint here touches email sending (capability 7) — there's no email infrastructure to extend yet; this phase only makes the data model ready for it (consent field is channel-agnostic by design, `preferred_channel` already includes `'email'`).

---

## 6. UI changes

- **Import wizard** (`/dashboard/customers/import` or similar) — 6 screens matching the spec's steps, replacing the current single-page Lead Import UI for this new flow (the existing `/dashboard/leads/import` page stays for the simple case).
- **Customer list management** — list view, create/rename/delete, add-from-search, add-from-segment-snapshot.
- **Segmentation / audience builder** — filter UI on top of the extended `buildSegment()`, with a live recipient-count preview (the existing `/api/campaigns` `action=preview` already does this pattern).
- **Consent toggle** — on the customer profile page (`customers/[id]/page.tsx`), a simple 3-state control for `marketing_consent`, plus `preferred_channel`.
- **Tags editor** — inline tag add/remove on the customer profile, reusing the existing `tags TEXT[]` column.
- **Campaign history view** — likely already partially exists given `broadcast_campaigns` + `GET /api/campaigns`; confirm current `campaigns/page.tsx` coverage before building new UI here.
- **Import history** — extend the existing history panel already in `dashboard/leads/import/page.tsx` (or a new equivalent) with the updated/duplicate counts.

---

## 7. Deployment sequence

1. Confirm production verification (outstanding — `audit/PRODUCTION_VERIFICATION_LEADS.sql`).
2. Resolve migration 017 per that verification (Section 4 — separate from everything else here).
3. Ship the Section 4 migration (leads columns, `customer_import_column_mappings`, `customer_lists`/`customer_list_members`, `lead_imports` columns) — additive, reviewed and applied via the same pre-flight/post-flight SQL Editor process as 016.
4. Ship the import wizard (API + UI), writing into the now-extended schema.
5. Extend `buildSegment()` + segmentation UI.
6. Ship customer lists (API + UI).
7. Close the WhatsApp compliance gaps (opt-out handling, consolidate the two send paths) — before campaign volume increases, not after.
8. Submit new WhatsApp templates (birthday, anniversary, etc.) to Meta — start in parallel with step 3, since approval lead time is external and otherwise becomes the critical path.
9. Ship birthday/anniversary cron + campaigns once templates are approved.
10. Email marketing: separate future initiative, not sequenced here — the data model from step 3 is ready for it, but sending infrastructure, deliverability, and compliance (CAN-SPAM/DPDP consent records) are a distinct scope this document doesn't design.

Each step is an independently reviewable, independently deployable change — nothing here is a single big-bang release.

---

## 8. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration file doesn't match production reality (the exact failure mode that caused the original proposal bug and the Lead Import bug) | Confirmed pattern, not hypothetical | High — silent insert failures, invisible to users | Live pre-flight/post-flight verification before every migration, as already established; this document changes nothing about that discipline |
| Duplicate customer records from bulk import at scale | Medium — app-level dedup only, no DB UNIQUE backstop confirmed on `leads.phone` (still unverified) | Medium — pollutes the marketing database, skews segment counts | Section 2's phone-UNIQUE verification is a precondition; import wizard's duplicate-resolution step (skip/update/merge) is mandatory, not optional |
| WhatsApp policy violation from scaled-up marketing sends without opt-out handling | Medium-High once volume increases | High — Meta can restrict or ban the business number | Close the opt-out gap (Section 6 of prior doc) before or alongside birthday/anniversary campaigns ship, not after |
| Two divergent WhatsApp send implementations both still in use | Medium | Medium — inconsistent rate limiting, one path non-compliant for cold sends | Consolidate before adding new campaign types on top of either |
| 10,000+ row import exceeding the 30s serverless limit | High if large files are actually used | Medium — stuck `'processing'` imports, confusing to admins | Staged approach already in the prior doc (client-side chunking first, queue-based worker later) |
| New tables/columns added without RLS policies | Low if following existing conventions, but a real gap if skipped | High — `analytics_events`/`follow_ups` already show this exact mistake (RLS-on-zero-policies) elsewhere in this codebase | Every new table gets a policy in the same migration that creates it, not a follow-up |
| `campaign_tags` vs `tags` ambiguity (Section 2, capability 4) causing double-built tag UIs | Low probability, easy to avoid | Low-Medium — wasted UI work, confusing data model | Clarify the two columns' intended purposes before building the tags editor, not after |

---

## 9. Rollback strategy

Consistent with every migration in this repo since 010: additive changes get an explicit `_ROLLBACK.sql` sibling, drop-and-recreate for constraints, plain `DROP COLUMN`/`DROP TABLE` for additive columns/tables — safe specifically because nothing existing is altered, so a rollback can only ever remove what this feature added, never touch pre-existing data or behavior.

- **`leads` new columns:** `ALTER TABLE leads DROP COLUMN IF EXISTS <each column>` — safe unless application code has already started writing to them; sequence rollback to happen only after the corresponding app-code deploy is rolled back first (schema rollback last, not first — the reverse order of how it was deployed).
- **New tables** (`customer_import_column_mappings`, `customer_lists`, `customer_list_members`): plain `DROP TABLE IF EXISTS`, cascade-safe since they only reference `leads(id)`, never referenced *by* anything else at this stage.
- **`lead_imports` new columns:** same `DROP COLUMN IF EXISTS` pattern.
- **`leads_source_check` extension (`'customer_import'`):** same pattern as `016_..._ROLLBACK.sql`/`017_..._ROLLBACK.sql` — check for any rows using the new value first, since a rollback that narrows a CHECK constraint fails if data already violates the narrower version; the rollback file should say so explicitly, as the existing ones do.
- **Application code:** each deployment step in Section 7 is independently revertible via normal `vercel deploy --prod` to the previous commit, since none of them require the *next* step's schema to function (each step lands additive schema before the code that depends on it, never the reverse).

---

## 10. Open items before implementation

1. Section 2's production verification, still outstanding.
2. Clarify `tags` vs `campaign_tags` intended purposes (Section 2, capability 4) — five-minute question, avoids building the wrong tags UI.
3. Confirm `broadcast_campaigns`/`festival_calendar` are actually live (part of the outstanding verification) — if not, Campaign History (capability 10) needs its own migration too, not just reuse.
4. Confirm sequencing preference: this document assumes import-wizard-first, WhatsApp-compliance-fixes-before-campaign-scale-up, per the prior document's Section 8 — say so if priorities differ.
