# Customer Bulk Import & Marketing Database — Design & Implementation Plan

Status: **DRAFT FOR REVIEW — no code written yet, per instruction.**
Scope: design only. Implementation begins only after this plan is reviewed and the verification items in Section 2 are confirmed against production.

---

## 1. Guiding architectural decision: extend `leads`, not a new `customers` table

`supabase/migrations/012_v3_foundation_schema.sql` (lines 40-44) records a confirmed Product Owner decision from 2026-07-13:

> "customer_id columns below reference leads(id) — extend leads, no parallel customers table. This was Section 8's recommended default and is now final, not provisional."

The existing "Customers" module (`src/app/(crm)/customers/page.tsx`) is literally a search UI wrapping `GET /api/leads?search=` — there is no separate customers table today, anywhere, live or in migrations. This plan follows that precedent: **the new bulk-import/marketing feature extends `leads` with additional marketing-oriented columns, rather than introducing a parallel `customers` entity.** Reopening that decision would be a significant architecture change and isn't warranted by anything found during this investigation — flagging it here only so it's an explicit, visible choice rather than a silent one.

---

## 2. Verification required before any migration is written

Given the migration-016 lesson (repo migration files did not match production reality for `leads.source`), the following must be confirmed live before Section 4's migration outline is finalized — **do not assume any of this from migration files alone.** Recommend bundling into the same SQL Editor session as the leads-constraint check already requested:

```sql
-- A. All CHECK constraints on leads (already requested — status/source)
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'leads'::regclass AND contype = 'c'
ORDER BY conname;

-- B. Does leads.phone actually have a UNIQUE constraint?
-- Two independent code comments (src/app/api/leads/route.ts:55,
-- src/lib/identity/resolve-identity.ts:57) assert it does, used to justify
-- "duplicate phone insert would fail anyway" logic. No migration file
-- shows this — only a plain index (idx_leads_phone, 001:167). If it's
-- real, it's undocumented drift (same pattern as everything else in this
-- codebase); if it's NOT real, those two code comments are wrong and
-- duplicate leads by phone are currently possible outside the paths that
-- happen to call resolveIdentity() first. This directly affects how much
-- the new bulk importer can rely on the DB layer vs. must enforce itself.
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'leads'::regclass AND conname ILIKE '%phone%';

-- C. Do the campaign tables this plan wants to build on actually exist live?
-- SCHEMA_DRIFT_REPORT.md Category B lists broadcast_campaigns,
-- festival_calendar, notification_settings as "defined in migrations but
-- NOT present live." If broadcast_campaigns doesn't exist, /api/campaigns
-- (src/app/api/campaigns/route.ts) is currently non-functional in
-- production, and this plan's "reuse the existing campaign send pipeline"
-- assumption needs revising before implementation.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('broadcast_campaigns', 'festival_calendar', 'lead_imports', 'whatsapp_messages');

-- D. Current live columns on leads (confirms which marketing fields already
-- exist vs. genuinely need to be added — cross-check against Section 3).
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'leads' ORDER BY ordinal_position;
```

---

## 3. Field gap analysis

Cross-referencing the spec's field list against `leads` as defined across migrations 001/003/004/008 plus documented drift (`audit/SCHEMA_DRIFT_REPORT.md` Category C):

| Spec field | Status |
|---|---|
| Customer Name, Mobile Number | Exists (`name`, `phone`) |
| Email | Exists (`email`) |
| Company | **Missing** |
| Event Type | Exists (`event_type`) |
| Source | Exists (`source`, CHECK-constrained) |
| City / State / Country / Address | **Missing** |
| Date of Visit | **Missing** (closest existing: `event_date`, not the same concept) |
| Birthday / Anniversary | **Missing** |
| Notes | Exists (`notes`) |
| Tags | Exists (`tags TEXT[]`) |
| Lead Owner | Partial — `owner_id` exists as documented drift (Category C), but no FK to `user_profiles`/`auth.users` (Category D gap) |
| Marketing Consent (Yes/No/Unknown) | Partial — `whatsapp_opted_in BOOLEAN` exists (migration 003) but is two-valued, WhatsApp-specific, and has **inconsistent semantics across the codebase today**: `src/lib/campaigns.ts:93` requires it strictly `= true` to be included in a segment, while `src/app/api/cron/followups/route.ts:62` only excludes on strictly `= false` (treating `null` as eligible). A new tri-state, channel-agnostic consent field is genuinely needed, not a reuse of this column as-is. |
| Preferred Communication Channel | **Missing** |

Also relevant, already present and reusable: `lead_score`, `ai_score`, `is_vip`, `lead_temperature`, `campaign_tags`, `repeat_customer`, `lifetime_value`.

---

## 4. Proposed data model changes (outline — pending Section 2 verification)

All additive, `ADD COLUMN IF NOT EXISTS`, no existing column touched — same pattern as migrations 003/004/008. Draft column set on `leads`:

- `company TEXT`
- `city TEXT`, `state TEXT`, `country TEXT`, `address TEXT`
- `date_of_visit DATE`
- `birthday DATE`, `anniversary DATE`
- `marketing_consent TEXT DEFAULT 'unknown' CHECK (marketing_consent IN ('yes','no','unknown'))` — new field, separate from `whatsapp_opted_in` (which stays as the WhatsApp-specific signal it already is; a future step should reconcile the two, out of scope here to avoid touching a column three other code paths already depend on)
- `preferred_channel TEXT CHECK (preferred_channel IN ('whatsapp','email','sms','call','any'))`
- `imported_from_customer_import BOOLEAN DEFAULT FALSE` — lets reporting distinguish bulk-imported records from organic leads without overloading `source`

New tables:
- `customer_import_column_mappings` (`id`, `user_id`, `mapping_name`, `column_map JSONB`, `created_at`, `updated_at`) — satisfies "mappings should be remembered for future imports." Keyed by user + a name so an admin can save/reuse named mapping presets (e.g. "Hotel PMS export").
- Extend `lead_imports` (already live, migration 009) with `ADD COLUMN IF NOT EXISTS updated_rows INTEGER DEFAULT 0` and `duplicate_rows INTEGER DEFAULT 0` — the existing table already has `total_rows/valid_rows/invalid_rows/status/error_log/imported_by/filename/created_at/completed_at`, covering most of the spec's audit-trail requirement; only the update/duplicate counts are missing.

`leads_source_check` gets one more additive value in the same family as 016/017: `'customer_import'`, distinct from `'excel_import'` (Lead Import) so reporting can tell the two features apart.

**Not proposed:** a separate `customers` table (Section 1), and no change to `whatsapp_opted_in`'s existing meaning (too many live call sites depend on its current semantics; reconciling it with the new `marketing_consent` field should be its own deliberate follow-up, not bundled here).

---

## 5. Reusable infrastructure inventory

This feature has substantially more to build on than a greenfield read suggests:

- **Import pipeline shape.** `src/app/api/leads/import/route.ts` (just hardened this session) already has the parse → validate → chunk → dedupe-by-phone → insert → audit-record pattern this spec asks for. The new wizard is this pattern generalized with column mapping, duplicate-resolution modes, and background processing — not a rewrite.
- **Excel/CSV parsing.** `src/lib/excel-parser.ts` already does header-flexible column mapping (`mapHeaders()`), phone normalization (canonical, cross-channel-consistent per Sprint 5), and email validation. The new wizard's Step 3 (column mapping UI) needs a *user-facing, persisted* version of the same idea — the underlying validation logic is reusable as-is.
- **Duplicate/identity resolution.** `src/lib/identity/resolve-identity.ts` already implements phone-first, email-fallback matching with explicit conflict surfacing (`hasConflictingIdentifier`) — exactly the detection logic Step 5 needs. It's currently read-only ("never creates or modifies a record"); the wizard's "Update existing" / "Merge missing information" actions are new write paths on top of this existing read layer, not a new matching algorithm.
- **Segmentation.** `src/lib/campaigns.ts`'s `buildSegment(filter)` already filters `leads` by status, source, min_score, event_type, venue, is_vip, days_since_inquiry. Extending it with city/state/country/tags/birthday-month/anniversary-month/marketing_consent/lead_owner is additive to an existing, working function, not new infrastructure.
- **WhatsApp send pipeline.** `src/lib/whatsapp/send-message.ts`'s `sendBroadcastCampaign()` already sends **approved templates** (not raw text) with retry logic and per-message logging to `whatsapp_messages`, which is the Meta-compliant pattern the spec's WhatsApp Marketing section needs (birthday/anniversary/festival messages are all business-initiated outside any 24h customer-service window, so they must use approved templates, not the free-text `sendWhatsAppText()` used by `/api/campaigns`'s POST `action=send`).
- **Campaign record-keeping.** `broadcast_campaigns` (migration 004) already has the right shape (`segment JSONB`, `channel`, `message_template`, `template_name`, `sent_count`/`failed_count`/`reply_count`) — **if Section 2 item C confirms it's live.**
- **Festival calendar.** `festival_calendar` (migration 004, seeded with 2026 Indian festivals) plus `src/lib/campaigns.ts`'s `generateFestivalMessage()` (Claude-generated festival greetings) directly cover the spec's "Festival Greetings" campaign example — **also pending the same live-existence check.**

---

## 6. Gaps that need closing, not just reuse

- **Two parallel, inconsistent WhatsApp send paths.** `src/app/api/campaigns/route.ts` (`action=send`) sends raw text via `sendWhatsAppText()` with a 1200ms delay between sends. `src/app/api/whatsapp/campaigns/route.ts` sends approved templates via `sendBroadcastCampaign()` with a 120ms delay. This duplication is already flagged as ISS-043 in the existing issue register ("resolved as part of ISS-015" — but ISS-015 itself is still open per `OPEN_ISSUES.md`). Before building new campaign types (birthday/anniversary/etc.) on top of either, these should converge on one implementation — almost certainly the template-based one, since ad-hoc marketing sends are exactly the case Meta requires templates for.
- **No opt-out handling on the inbound side.** Zero references to STOP/unsubscribe keyword handling in `src/app/api/whatsapp/webhook/route.ts`. `whatsapp_opted_in` is only ever set to `true` (`src/lib/whatsapp/lead-resolver.ts:69`, on inbound contact) — nothing in the codebase ever sets it to `false`. Scaling up outbound marketing volume without a working opt-out path is a real compliance risk, not a nice-to-have. Recommend this ships alongside (or before) the first new bulk campaign type, even though it's technically a separate change.
- **No approved templates yet for the new campaign types.** `src/lib/templates.ts`'s `APPROVED_TEMPLATES` has `INQUIRY_FOLLOWUP`, `FESTIVAL_PROMO`, `REENGAGEMENT`, `BOOKING_CONFIRMATION`, `REVIEW_REQUEST` — nothing for birthday/anniversary/wedding-offer/banquet-promo/etc. Each new campaign type needs a template submitted and approved in WhatsApp Business Manager before it can send — this is an external, non-engineering lead time item worth flagging early since it can take days.
- **10,000+ row / background processing.** The current import route runs synchronously inside a single request with `maxDuration = 30` (Vercel serverless limit). That ceiling is incompatible with "10,000+ records" and "background processing" as stated requirements. This needs an actual background job mechanism — options, roughly in order of how much new infrastructure they need:
  1. Client-side chunked upload (browser splits the parsed rows into batches, calls the import endpoint repeatedly, shows a real progress bar) — no new backend infra, works within the existing 30s-per-request ceiling, but ties completion to the browser tab staying open.
  2. A queue table (`import_jobs` + row-level `import_job_rows`) processed by a cron/worker route (the codebase already has a cron pattern — `src/app/api/cron/followups/route.ts`, `src/app/api/cron/escalations/route.ts`) polling and processing N rows per invocation until done. Survives tab close, more moving parts.
  3. Vercel's longer-duration background functions / a queue service, if available on the current plan — needs an infra decision, not just code.

  Recommend starting with (1) for the initial ship (smallest safe change, no new infra) and treating (2) as the natural next step once real usage data shows it's needed — consistent with "implement the smallest safe changes."

---

## 7. Import wizard — step-to-implementation mapping

| Spec step | Implementation approach |
|---|---|
| 1. Upload | Same file-type/size gate as the existing Lead Import route, reused as-is. |
| 2. Preview (first 50 rows) | New: parse client-side or via a `?previewOnly=true` request that returns parsed rows without inserting — `excel-parser.ts`'s `parseExcelBuffer()` already returns structured rows, just needs a preview-only entry point that skips the DB round-trip. |
| 3. Column mapping (remembered) | New UI + `customer_import_column_mappings` table (Section 4). `mapHeaders()`'s flexible-header logic becomes the *default suggestion*, user can override, override gets saved. |
| 4. Validation | Extends `excel-parser.ts`'s existing checks (missing name/phone, invalid phone/email) with duplicate-phone and duplicate-email detection *within the file itself* (same intra-batch dedup pattern just added to Lead Import) before anything is compared against the database. |
| 5. Duplicate handling (skip / update / merge / import-as-new) | Built on `resolveIdentity()` (Section 5) for detection; each of the four actions is a distinct, explicit write path — "merge missing information" specifically means: for each mapped field, only write it if the existing record's value is null/empty, never overwrite populated data. This needs to be spelled out precisely in a follow-up ticket since "merge" is the one action with real ambiguity. |
| 6. Import summary + error report download | Extends the existing `lead_imports` summary response (already returns total/inserted/skipped/invalid) with the two new counts (updated, duplicate) from Section 4; error report download is a CSV export of `error_log`, no new backend needed beyond what already exists. |

---

## 8. Suggested rollout sequence

1. Confirm Section 2 verification items live.
2. Ship the additive `leads` migration + `customer_import_column_mappings` table + `lead_imports` column additions (small, low-risk, matches house style).
3. Ship the import wizard (Steps 1-6) writing into the now-extended `leads` table, initially with client-side chunking (Section 6, option 1) — functionally complete for admin bulk import, not yet wired to campaigns.
4. Extend `buildSegment()` with the new filters (city/state/country/tags/birthday-month/anniversary-month/marketing_consent/lead_owner) and add a segmentation UI on top of it.
5. Close the opt-out gap and consolidate the two WhatsApp send paths (Section 6) — a prerequisite, not a parallel track, before campaign volume increases.
6. Submit new WhatsApp template types (birthday, anniversary, wedding offer, etc.) for Meta approval — start this in parallel with step 2, since approval lead time is external and otherwise becomes the critical path.
7. Ship the new campaign types once templates are approved, reusing `broadcast_campaigns` + `sendBroadcastCampaign()`.
8. Revisit background-processing needs (Section 6, option 2) based on real import volume once step 3 is live.

Each step above is intended as its own reviewable change, not one large migration/PR — consistent with "make one logical change at a time."

---

## 9. Open questions for you before implementation starts

1. Section 2's live-verification queries — please run and share results (bundled with the leads_source_check/leads_status_check check already requested).
2. `marketing_consent` as a new field vs. reusing/renaming `whatsapp_opted_in`: this plan keeps them separate (Section 4) to avoid touching a column 5+ live call sites depend on. Confirm that's acceptable, or if you'd rather do the reconciliation now as part of this feature.
3. Rollout sequencing (Section 8) assumes the import wizard ships before campaign-sending changes. Confirm that ordering matches your priority, or if campaign/WhatsApp compliance fixes (Section 6) should come first.
4. Do you have (or need to start) the Meta Business Manager template submissions for the new campaign types now, given the external lead time noted in Section 8 step 6?
