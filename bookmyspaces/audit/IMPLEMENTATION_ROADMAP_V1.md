# BookMySpaces CRM V3 — Master Implementation Roadmap (v1.0)

**Status:** Master execution document. Architecture v1.0 (the five ADR/design documents in `audit/`) is frozen and authoritative. No phase below redesigns the architecture — each implements a slice of it. Reopen the architecture only if production verification contradicts an assumption, a production issue requires it, or an approved requirement genuinely cannot fit — per the standing rule already agreed.

All database changes below are additive, `IF NOT EXISTS`, pre-flight/post-flight verified against production before applying — the same discipline already proven across migrations 010/016/017. No phase begins until the phase before it has met its Definition of Done.

---

## PHASE 0 — Production Verification & Stabilization

| Complexity | Dev Order | Dependencies | Risk Level |
|---|---|---|---|
| Low | 1 (blocking) | None | Low technical risk, high consequence if skipped |

**1. Business Objective:** Establish verified production ground truth and a fully working Lead Import module before any new feature work begins. Every later phase's migrations assume this baseline is accurate — this is the phase the entire architecture review series exists to close.

**2. Technical Scope:** Run `audit/PRODUCTION_VERIFICATION_LEADS.sql`; reconcile results against Architecture v1.0's assumptions (the Gap Analysis template in this document's predecessor); resolve migration 017's necessity one way or the other; confirm the Lead Import fix already shipped this session works end-to-end against real production data.

**3. Database Changes:** None assumed. Conditional: migration 017 (`leads_source_check` + `'excel_import'`) applies *only if* verification shows it's genuinely missing. If production already has it, delete migration 017 from the repo rather than leaving an unneeded file behind.

**4. API Changes:** None new. `src/app/api/leads/import/route.ts` was already patched this session (status mapping to `'new_inquiry'`, source whitelist validation, intra-chunk duplicate detection, insert-error surfacing) — this phase validates that fix in production, it doesn't extend it.

**5. UI Changes:** None.

**6. Background Jobs:** None.

**7. Testing Requirements:** A route-level integration test for the import insert path against a real or accurately-mocked `leads` schema — currently missing, and its absence is exactly why the status/source bug shipped undetected originally. This test should exist before Phase 0 is considered closed.

**8. Regression Tests:** `src/lib/excel-parser.test.ts` (existing, unaffected by this session's changes). Manual regression pass on every module reading `leads.status`/`leads.source` to confirm the verification didn't surface an unexpected value already in use.

**9. Deployment Steps:**
1. Run the verification script in the Supabase SQL Editor.
2. Reconcile every result against Architecture v1.0's assumptions; document any drift found.
3. Apply migration 017 only if step 2 shows it's needed; otherwise delete the file.
4. Confirm the already-patched `route.ts` is live (redeploy if not).
5. Upload a small real test file and confirm `summary.inserted > 0` with correct `status`/`source` values on the resulting rows.

**10. Rollback Plan:** App code — standard revert-and-redeploy. Migration 017, if applied — `017_leads_source_add_excel_import_ROLLBACK.sql` already exists, with its documented caveat: fails safely (by design) if any `'excel_import'` rows already exist by the time a rollback is attempted.

**11. Risks:** Production schema differs further from repository assumptions than expected — this is the specific risk the phase exists to retire, not a reason to skip it. Silently deploying a wrong assumption without verification is the one failure mode explicitly ruled out by this phase's existence.

**12. Dependencies:** None — this is the root of the whole roadmap's dependency graph.

**13. Estimated Complexity:** Low — verification plus at most a single-value additive migration, on top of a code fix already completed.

**14. Estimated Development Order:** 1, blocking every subsequent phase.

**15. Definition of Done:** Production verification results fully reconciled against Architecture v1.0 with zero unresolved gaps; Lead Import tested end-to-end against real production data with correct results; migration 017 either applied-and-confirmed or removed from the repository.

---

## PHASE 1 — Customer Bulk Import

| Complexity | Dev Order | Dependencies | Risk Level |
|---|---|---|---|
| High | 2 | Phase 0 | Medium — duplicate-detection correctness hinges on Phase 0's phone-UNIQUE finding |

**1. Business Objective:** Let administrators bulk-import customer records (hotel guests, banquet customers, corporate clients, past leads) from Excel/CSV through a guided, safe, auditable workflow that never silently creates duplicates.

**2. Technical Scope:** The full 6-step wizard — upload, preview (first 50 rows), column mapping (saved/reusable), validation, duplicate resolution (skip/update/merge/new), import summary + audit log. Built on the already-stabilized Lead Import pipeline's parse/validate/chunk pattern and the existing `resolveIdentity()` matcher — extended, not rewritten.

**3. Database Changes:**
- `leads` additive columns: `company`, `city`, `state`, `country`, `address`, `date_of_visit`, `birthday`, `anniversary`, `preferred_channel`, `imported_from_customer_import`, `imported_via_import_id` (FK → `lead_imports.id`).
- `leads_source_check` additive value: `'customer_import'`.
- New table `customer_import_column_mappings` (`id`, `user_id`, `mapping_name`, `column_map JSONB`, timestamps) + RLS.
- `lead_imports` additive columns: `updated_rows`, `duplicate_rows`.

**4. API Changes:** `POST /api/customers/import/preview` (parse-only, no writes), `GET/POST /api/customers/import/mappings` (saved mapping presets), `POST /api/customers/import/commit` (real import with chosen duplicate-resolution mode).

**5. UI Changes:** New 6-screen wizard at `/dashboard/customers/import`. Existing `/dashboard/leads/import` stays untouched for the simple case.

**6. Background Jobs:** Client-side chunked upload for this phase's initial ship (browser batches rows, repeated calls within the existing 30s-per-request serverless limit, live progress bar) — no new server-side queue infrastructure yet. A queue-based worker is explicitly deferred (Future Enhancements, below) until real usage data shows client-side chunking isn't enough.

**7. Testing Requirements:** Extended parser tests for the new field set; column-mapping save/load/reuse tests; one test per duplicate-resolution mode; an explicit test that "merge" only fills null fields and never overwrites populated ones (the one action with real semantic ambiguity, per prior review).

**8. Regression Tests:** Confirm `/dashboard/leads/import` and its API are completely unaffected — this phase is additive alongside it, not a replacement.

**9. Deployment Steps:** Migrations (each column/table group as its own file) → verified against Phase 0's confirmed baseline → API routes → UI → smoke test with a real multi-hundred-row file covering all four duplicate-resolution modes.

**10. Rollback Plan:** `DROP COLUMN`/`DROP TABLE IF EXISTS` per addition, app-code rollback sequenced before schema rollback (never the reverse — matches established project discipline).

**11. Risks:** 10,000+ row files against the 30s serverless ceiling (mitigated for this phase by client-side chunking); duplicate detection is only as strong as Phase 0's phone-UNIQUE confirmation — if that came back "not unique," this phase's duplicate handling carries more weight and needs extra scrutiny.

**12. Dependencies:** Phase 0 complete, specifically the phone-UNIQUE and RLS findings.

**13. Estimated Complexity:** High — new wizard, new tables, four distinct duplicate-resolution code paths, background-processing considerations.

**14. Estimated Development Order:** 2.

**15. Definition of Done:** A 1,000+ row real-world file imports successfully end to end with accurate audit counts (inserted/updated/skipped-duplicate/invalid all reconciling to the total row count); every imported record traceable back to its import batch; every imported record's consent defaulted to `'unknown'`, never inferred.

---

## PHASE 2 — Customer Data Management

| Complexity | Dev Order | Dependencies | Risk Level |
|---|---|---|---|
| Medium-High | 3 | Phase 0, Phase 1 | Medium — touches ~15 existing files' status assumptions |

**1. Business Objective:** Implement the frozen lifecycle/consent ADRs — separate customer identity/classification from sales pipeline — and bring the Customers module to full search/profile/audit capability.

**2. Technical Scope:** `lifecycle_stage`, revived `campaign_tags` for marketing labels, `is_corporate`, per-channel consent (`whatsapp_consent`/`email_consent`/`sms_consent`), extended customer search/filters, customer profile enhancements, timeline, audit history.

**3. Database Changes:**
- `leads.lifecycle_stage TEXT DEFAULT 'lead' CHECK (lifecycle_stage IN ('lead','customer'))`.
- `leads_status_check` additive value: `'no_active_pipeline'`.
- `leads.is_corporate BOOLEAN DEFAULT FALSE`.
- `leads.whatsapp_consent`/`email_consent`/`sms_consent TEXT DEFAULT 'unknown' CHECK (... IN ('yes','no','unknown'))` + one-time backfill from `whatsapp_opted_in` (run and verify as a separate step from the column addition itself).

**Open decision, not assumed here:** how existing rows backfill `lifecycle_stage` — everything defaults to `'lead'` (safest), or rows already at `status = 'confirmed'` backfill to `'customer'` (more accurate but a judgment call). Needs an explicit answer before this phase's migration is written.

**4. API Changes:** `PATCH /api/leads`'s `updateLeadSchema` allow-list extended (`lifecycle_stage`, `is_corporate`, the three consent fields, `campaign_tags`); `GET /api/leads` search/filter extended (city, `tags`, `campaign_tags`, company). Reuse `src/app/api/customers/[id]/timeline/route.ts` if it already covers audit history — confirm before building anything new.

**5. UI Changes:** Customer profile — lifecycle badge, three-state consent toggles, tags editor writing to `campaign_tags` (not `tags`, which stays scorer-owned); advanced filters on the Customers search page.

**6. Background Jobs:** Application-level `repeat_customer` trigger — set `true` when a second confirmed proposal/booking is found for the same phone. This is new behavior, not a reuse of dormant schema; it needs its own logic and its own test.

**7. Testing Requirements:** Backfill correctness tests; a regression test per existing `status`-consuming module confirming it tolerates `'no_active_pipeline'` without mis-rendering (kanban, hot-leads dashboard, dashboard stats, escalation engine, followup cron, proposal intelligence — the ~15 files already identified this session).

**8. Regression Tests:** Full pass on every pipeline-status-driven view post-migration — this is the phase most likely to surface a hardcoded status switch/dropdown that wasn't expecting a new value.

**9. Deployment Steps:** Separate migration file per column group (one logical change at a time) → backfill run and verified independently → API/UI deploy → full regression pass before considering this phase done.

**10. Rollback Plan:** Additive-column rollback; `whatsapp_opted_in` itself is never touched or removed, so rolling back the new consent columns loses no existing signal.

**11. Risks:** The `lifecycle_stage` backfill decision, if made carelessly, mislabels existing customers; an unhandled `'no_active_pipeline'` value breaking a hardcoded UI element somewhere in the ~15 affected files.

**12. Dependencies:** Phase 0 (baseline) and Phase 1 (bulk-imported customers are the primary near-term population needing `lifecycle_stage = 'customer'` from day one).

**13. Estimated Complexity:** Medium-High — the schema additions themselves are simple; the blast radius across existing status-consuming code is the real work.

**14. Estimated Development Order:** 3.

**15. Definition of Done:** Every existing status-driven view renders correctly post-migration with no manual fixes needed after the fact; `lifecycle_stage` accurately reflects both bulk-imported and organic customers; consent backfill counts sanity-checked against the pre-migration `whatsapp_opted_in` distribution.

---

## PHASE 3 — Customer Lists & Segmentation

| Complexity | Dev Order | Dependencies | Risk Level |
|---|---|---|---|
| Medium | 4 | Phase 2 | Low-Medium |

**1. Business Objective:** Give administrators reusable dynamic audiences (segments) and curated static lists for marketing targeting, with the ability to freeze one into the other.

**2. Technical Scope:** `customer_lists`/`customer_list_members` tables, `buildSegment()` filter extension, segment-to-list snapshot capability, list management UI.

**3. Database Changes:** `CREATE TABLE customer_lists` (`id`, `name`, `description`, `created_by`, `created_at`, optional `source_segment JSONB` for snapshots) + RLS. `CREATE TABLE customer_list_members` (`list_id`, `lead_id`, `added_at`, composite PK) + RLS.

**4. API Changes:** `GET/POST/DELETE /api/customer-lists`, `POST /api/customer-lists/[id]/members`; `buildSegment()`'s `SegmentFilter` extended with city/state/country/`tags`/`campaign_tags`/birthday-month/anniversary-month/consent/`lead_owner`.

**5. UI Changes:** Segmentation/audience builder with a live recipient-count preview (reusing the existing `/api/campaigns` `action=preview` pattern); list management (create/rename/delete/add-from-search/add-from-segment-snapshot).

**6. Background Jobs:** None new — snapshotting is synchronous at list-creation time.

**7. Testing Requirements:** One `buildSegment()` unit test per new filter dimension; list CRUD tests; a test confirming a snapshot's membership doesn't drift when source data changes afterward.

**8. Regression Tests:** Confirm the existing `/api/campaigns` preview/create/send actions still work unmodified against the extended `buildSegment()`.

**9. Deployment Steps:** Migrations → `buildSegment()` extension → API → UI → smoke test with one real segment and one real static list.

**10. Rollback Plan:** `DROP TABLE IF EXISTS` (members table before parent, FK order) — nothing outside Marketing references these tables yet at this phase.

**11. Risks:** Segment preview counts drifting from actual campaign-time recipients if the freeze point isn't well-defined — this is exactly what Phase 4's `campaign_recipients` design exists to close, so this phase's list/segment snapshot behavior needs to be consistent with that plan, not solved independently.

**12. Dependencies:** Phase 2 — without `lifecycle_stage`/consent/`is_corporate`/`campaign_tags`, most of this phase's new filter dimensions have nothing to filter on.

**13. Estimated Complexity:** Medium.

**14. Estimated Development Order:** 4.

**15. Definition of Done:** A saved segment and a static list both resolve to their expected member sets on demand; RLS confirmed correct for both new tables (authenticated read/write, anon denied).

---

## PHASE 4 — WhatsApp Marketing

| Complexity | Dev Order | Dependencies | Risk Level |
|---|---|---|---|
| High | 5 | Phase 3, Meta template approval (external) | High — compliance-sensitive |

**1. Business Objective:** Ship compliant, scalable WhatsApp bulk marketing (birthday, anniversary, festival, wedding-offer, banquet-promo, etc.) on approved templates with enforceable, honored consent.

**2. Technical Scope:** `campaign_recipients` table; consolidation of the two existing WhatsApp send implementations (`sendWhatsAppText`-based vs. approved-template-based) onto the compliant template path; opt-out/STOP handling in the inbound webhook (currently absent entirely); new template submissions; campaign analytics built on real per-recipient data instead of hand-incremented counters.

**3. Database Changes:** `CREATE TABLE campaign_recipients` (`campaign_id`, `lead_id`, `channel`, `status`, `sent_at`, `delivered_at`, `failed_reason`, `whatsapp_message_id`) + RLS. `broadcast_campaigns.channel` CHECK extended for `'sms'` if not already broad enough — verify against Phase 0's confirmed-live schema first, don't assume.

**4. API Changes:** Recipient selection wired to Phase 3's segments/lists; campaign creation freezes recipients into `campaign_recipients` at *creation* time, not send time (closes the recipient-drift gap identified in the architecture review); webhook route gains STOP-keyword handling that flips `whatsapp_consent` to `'no'`.

**5. UI Changes:** Campaign builder (recipient selection from list/segment, template picker, scheduling), delivery-tracking dashboard, analytics view built on `campaign_recipients`.

**6. Background Jobs:** Campaign send job (iterates `campaign_recipients`, respects rate limits, updates per-recipient status); birthday/anniversary cron (`src/app/api/cron/birthday-wishes/route.ts`, following the existing `cron/followups/route.ts` pattern).

**7. Testing Requirements:** Send-path consolidation tests against a mocked Meta API; opt-out webhook test (STOP correctly flips consent and a subsequent segment build correctly excludes that contact); rate-limit tests (the two existing implementations use inconsistent delays — 1200ms vs. 120ms — this phase settles on one tested value, not two).

**8. Regression Tests:** Existing `/api/campaigns` and `/api/whatsapp/campaigns` behavior preserved throughout a feature-flagged transition period, not cut over in one step.

**9. Deployment Steps:** `campaign_recipients` migration → opt-out handling deployed **first**, ahead of any volume increase, since it's compliance-critical → send-path consolidation behind a feature flag → each new template enabled only after its individual Meta approval is confirmed → cron jobs last.

**10. Rollback Plan:** `DROP TABLE IF EXISTS campaign_recipients`; send-path consolidation rolls back via flag toggle, not a schema rollback — keep the flag available through at least one full campaign cycle before removing the legacy path from the codebase.

**11. Risks:** Sending before a template's Meta approval clears (hard blocker, not a soft failure); scaling send volume before opt-out handling ships (real risk to the WhatsApp Business number, not just a UX gap); recipient-list drift if `campaign_recipients` isn't correctly frozen at creation.

**12. Dependencies:** Phase 3 (segments/lists to target); Meta template approval — external, should start in parallel with Phases 2-3, not wait until this phase begins, since approval lead time is otherwise the critical path.

**13. Estimated Complexity:** High — compliance-sensitive, external dependency, consolidates two already-inconsistent code paths.

**14. Estimated Development Order:** 5.

**15. Definition of Done:** A real campaign sends successfully to a consented, list-defined audience with full per-recipient delivery tracking; STOP demonstrably removes a contact from future campaign targeting; both legacy send paths retired, one consolidated path remains.

---

## PHASE 5 — Email Marketing Foundation

| Complexity | Dev Order | Dependencies | Risk Level |
|---|---|---|---|
| Low (by design) | 6 | Phase 2, Phase 4 | Low |

**1. Business Objective:** Establish the data model and minimal infrastructure for future email campaigns — explicitly a foundation, not a shipped campaign feature, per your own framing.

**2. Technical Scope:** Email provider selection (**open decision, not assumed by this roadmap** — SendGrid/Postmark/SES/Resend/other, to be chosen when this phase actually starts); an email message log table; reuse of Phase 4's channel-agnostic `campaign_recipients` shape rather than a duplicate parallel structure.

**3. Database Changes:** Minimal. `email_consent`/`preferred_channel` already exist from Phase 2. `broadcast_campaigns.channel` already supports `'email'`/`'both'`. The only new schema this phase strictly needs is a message log table, whose exact shape depends on the chosen provider's webhook/event model — not designed in detail until that choice is made.

**4. API Changes:** Provider-dependent, unscoped until the Phase 4/5 boundary decision is made.

**5. UI Changes:** None at foundation stage, or a minimal template-list placeholder at most.

**6. Background Jobs:** None at foundation stage.

**7. Testing Requirements:** None specified yet — deliberately deferred until a provider is chosen, consistent with not building test coverage against infrastructure that doesn't exist.

**8. Regression Tests:** None — no existing behavior is touched by this phase.

**9. Deployment Steps:** Provider selection decision → minimal send-and-log smoke test → stop. Full campaign UI is out of this phase's scope by design.

**10. Rollback Plan:** `DROP TABLE IF EXISTS` for whatever log table gets created — the lowest-risk rollback of all seven phases; nothing else in the roadmap depends on this phase existing.

**11. Risks:** Scope creep beyond "foundation" — building a full campaign feature here would repeat the exact speculative-schema mistake the architecture review already warned against (ADR-011), just applied to a whole feature instead of a column.

**12. Dependencies:** Phase 2 (consent/`preferred_channel`), Phase 4 (shared campaign-framework patterns to reuse, not duplicate).

**13. Estimated Complexity:** Low, deliberately.

**14. Estimated Development Order:** 6.

**15. Definition of Done:** Provider chosen and documented; one test email sent and logged successfully. Nothing more — full campaign capability is explicitly future scope.

---

## PHASE 6 — AI Customer Intelligence (Preparation)

| Complexity | Dev Order | Dependencies | Risk Level |
|---|---|---|---|
| Low | 7 (last) | Phase 4, Phase 5 | Low |

**1. Business Objective:** Prepare the data foundation for future AI-driven segmentation, scoring, and personalization — without building speculative model-output columns ahead of an actual model, per ADR-011.

**2. Technical Scope:** Confirm the existing scoring infrastructure (`lead_score`, `ai_score`, `ai_score_reason`, `lead_temperature`, `booking_probability`) is sufficient input signal for future work; add `last_engagement_at`/`last_engagement_channel` — the one AI-readiness addition with demonstrated near-term value, per the architecture review. Explicitly **do not** add `churn_risk_score`, `next_best_action`, or similar until an actual model is scoped.

**3. Database Changes:** `leads.last_engagement_at TIMESTAMPTZ`, `leads.last_engagement_channel TEXT` — the only schema change this phase makes.

**4. API Changes:** None required at preparation stage.

**5. UI Changes:** None required at preparation stage.

**6. Background Jobs:** A backfill/ongoing-update job populating `last_engagement_at`/`last_engagement_channel` from existing channel activity (WhatsApp messages today, email once Phase 5 exists) — the one piece of real infrastructure this phase needs.

**7. Testing Requirements:** Correctness of `last_engagement_at` population across channels.

**8. Regression Tests:** None — additive, unconsumed columns until an actual AI feature reads them.

**9. Deployment Steps:** Single additive migration → backfill job → done.

**10. Rollback Plan:** `DROP COLUMN IF EXISTS` — trivial; nothing depends on these columns yet.

**11. Risks:** Scope creep into building speculative AI-output columns before a model exists — the specific thing this phase should resist, per ADR-011.

**12. Dependencies:** Phase 4 (WhatsApp engagement data) and Phase 5 (email engagement data) as the sources `last_engagement_at` reads from.

**13. Estimated Complexity:** Low.

**14. Estimated Development Order:** 7, last — genuinely preparatory, not a feature.

**15. Definition of Done:** `last_engagement_at`/`channel` populated and accurate for every contact with WhatsApp (and later email) activity. No AI-output columns added. Actual AI feature scoping is treated as separate, future, evidence-triggered work — this phase explicitly stops here.

---

## MASTER PROJECT DASHBOARD

### Project Progress Tracker

| Phase | Status | Dependencies | Risk Level | Estimated Duration |
|---|---|---|---|---|
| 0 — Verification & Stabilization | Not Started (verification pending — `audit/PRODUCTION_VERIFICATION_LEADS.sql` results outstanding) | None | Low | Short — days, not weeks, once results are in |
| 1 — Customer Bulk Import | Not Started | Phase 0 | Medium | Medium — largest new-surface phase before Phase 4 |
| 2 — Customer Data Management | Not Started | Phase 0, 1 | Medium | Medium — wide blast radius, moderate new schema |
| 3 — Customer Lists & Segmentation | Not Started | Phase 2 | Low-Medium | Short-Medium |
| 4 — WhatsApp Marketing | Not Started | Phase 3, Meta approval | High | Medium-Long — gated by external approval lead time |
| 5 — Email Marketing Foundation | Not Started | Phase 2, 4 | Low | Short, deliberately |
| 6 — AI Customer Intelligence Prep | Not Started | Phase 4, 5 | Low | Short |

*Durations are rough relative estimates, not commitments — no real velocity data exists yet for this team on this roadmap. Recommend re-estimating after Phase 0 and Phase 1 actually ship, using their real elapsed time as the baseline for everything after.*

### Milestone Checklist

- [ ] Production verification results received and reconciled.
- [ ] Migration 017 resolved (applied or deleted).
- [ ] Lead Import confirmed working end-to-end in production.
- [ ] Customer Bulk Import wizard live, first real 1,000+ row import completed successfully.
- [ ] `lifecycle_stage`/consent/`is_corporate` live, zero regressions in existing status-driven views.
- [ ] First saved segment and first static list created and used.
- [ ] First WhatsApp template approved by Meta for a new campaign type.
- [ ] Opt-out (STOP) handling live and verified before any campaign volume increase.
- [ ] First compliant WhatsApp marketing campaign sent successfully.
- [ ] Email provider selected and first test send logged.
- [ ] `last_engagement_at` populated across all active channels.

### Critical Path

Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4. Phases 5 and 6 depend on Phase 4 but can be scoped/started in parallel with the tail end of Phase 4 once `campaign_recipients` and the consolidated send path are stable — flagged as an option, not the default sequencing. Meta template approval (external, feeds Phase 4) should start no later than the beginning of Phase 2, since its lead time otherwise becomes the critical path all on its own.

### Production Readiness Checklist (apply at the end of every phase, not just once)

- [ ] Pre-flight verification query run and results match expectations before any migration is applied.
- [ ] Migration applied via the additive/`IF NOT EXISTS` pattern, post-flight verification run.
- [ ] Rollback script exists and its failure conditions are documented (matching the 016/017 pattern).
- [ ] Regression suite passed for every module touched, direct or incidental.
- [ ] Manual smoke test performed against real (not synthetic-only) data.
- [ ] No unhandled new enum/constraint value left un-reviewed in any UI component.

### Architecture Compliance Checklist (apply at the end of every phase)

- [ ] No parallel `customers` table introduced (ADR-001).
- [ ] `lifecycle_stage` and pipeline `status` remain independent axes, neither overloaded into the other (ADR-002, ADR-003).
- [ ] `tags` and `campaign_tags` responsibilities remain separate (ADR-005).
- [ ] Consent modeled per-channel, not as a single flag (ADR-006).
- [ ] No speculative AI-output columns added ahead of a scoped model (ADR-011).
- [ ] No multi-identifier Contact table built without demonstrated need (ADR-010).
- [ ] Every new table has an RLS policy in the same migration that creates it, not a follow-up.

### Technical Debt Register

| Item | Origin | Status |
|---|---|---|
| No route-level test for Lead Import's DB insert path | Pre-existing, surfaced this session | Should close in Phase 0 |
| `repeat_customer` column exists but nothing populates it | Migration 004, dead since creation | Closes in Phase 2 |
| `campaign_tags` column exists but unused | Migration 003, dead since creation | Revived in Phase 2 |
| Two inconsistent WhatsApp send implementations | Pre-existing (ISS-043 in prior audit) | Consolidated in Phase 4 |
| No opt-out/STOP handling on WhatsApp webhook | Pre-existing gap | Closed in Phase 4 |
| `broadcast_campaigns`/`festival_calendar` possibly not live | Migration-defined, drift-flagged | Confirmed in Phase 0 |
| Migration 009 undocumented in original sequence | Historical, already understood | No action needed — already documented after the fact |
| `tsconfig.scopedcheck.json` leftover in repo root | This session's sandbox tooling, not deletable from this environment | Delete manually when convenient — harmless |

### Known Risks

- Production schema drift beyond what's already found (root reason Phase 0 exists).
- Meta template approval lead time becoming the critical path if not started early enough.
- WhatsApp Business number compliance risk if send volume scales ahead of opt-out handling (Phase 4 sequencing exists specifically to prevent this).
- Backfill correctness for `lifecycle_stage` on existing rows — a judgment call, not a mechanical migration, and worth getting right the first time.
- 10,000+ row import performance against the 30-second serverless ceiling — mitigated, not eliminated, by Phase 1's client-side chunking approach.

### Future Enhancements (Category C — deferred by design, not forgotten)

- Opportunity as a first-class entity, decoupled from Contact (ADR-009) — triggered by evidenced need for concurrent opportunities per customer.
- Multi-identifier Contact model for multiple phones/emails (ADR-010) — triggered by evidenced multi-identifier cases.
- Adoption of migration 012's `unified_conversations`/`unified_messages` schema for true omnichannel history — natural point to adopt it is whenever Email/SMS conversations are actually built.
- Queue-based background import processing, if client-side chunking (Phase 1) proves insufficient at real volume.
- Loyalty points/tier schema, once that feature is actually scoped.
- SMS as a third messaging channel, following the same `campaign_recipients`/consent pattern already built for WhatsApp/Email.
- Full AI feature set (churn prediction, next-best-action, AI-driven segmentation) — schema-ready per Phase 6, but each feature designs its own output storage when it's actually scoped, not before.
