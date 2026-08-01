# Production Migration State Verification

Written: 2026-07-29, RC1 mode. Verification and documentation only — no code changed, per instruction.

**Upfront constraint, stated plainly so nothing below is mistaken for a live check:** this sandbox has no network route to the production Supabase project (re-confirmed this session — DNS/connect failure through the sandbox's allowlisted proxy, consistent with every prior session in this project's history). I cannot run a single query against the live database. Everything graded "confirmed" below is confirmed from repository evidence (migration file contents, code that depends on them, and prior sessions' documented findings) — not from a live query. Where a claim can only be settled by a live query, this document says so and gives the exact query.

---

## 1. Every migration from 001 onward

26 forward migration files, 001–025, plus 14 paired `_ROLLBACK.sql` files (004, 012–025). File dates below are filesystem timestamps (evidence of *when written*, not when applied):

| # | File | Written | Rollback exists |
|---|---|---|---|
| 001 | `001_initial_schema.sql` | May 6 | no |
| 002 | `002_phase2_whatsapp.sql` | May 6 | no |
| 003 | `003_phase3_proposals.sql` | May 6 | no |
| 004 | `004_phase4_campaigns.sql` | May 6 (rollback written Jul 15) | yes |
| 005 | `005_stability_patch.sql` | Jul 15 | no |
| 006 | `006_final_verification.sql` | May 7 | no |
| 007 | `007_missing_tables.sql` | May 7 | no |
| 008 | `008_phase1_lead_scoring.sql` | May 19 | no |
| 009 | `009_document_undocumented_production_objects.sql` | Jul 15 | no |
| 010 | `010_phase5_proposal_intelligence.sql` | May 21 | no |
| 011 | `011_email_log.sql` | Jul 15 | no |
| 012 | `012_v3_foundation_schema.sql` | Jul 15 | yes |
| 013 | `013_proposal_reservation_links.sql` | Jul 15 | yes |
| 014 | `014_social_foundation.sql` | Jul 22 | yes |
| 015 | `015_audit_log_and_refunds.sql` | Jul 22 | yes |
| 016 | `016_leads_source_add_proposal.sql` | Jul 23 | yes |
| 017 | `017_leads_source_add_excel_import.sql` | Jul 23 | yes |
| 018 | `018_customer_bulk_import_fields.sql` | Jul 23 | yes |
| 019 | `019_stage_transitions.sql` | Jul 26 | yes |
| 020 | `020_campaign_types_extend.sql` | Jul 26 | yes |
| 021 | `021_campaign_scheduler.sql` | Jul 26 | yes |
| 022 | `022_winback_automation_seed.sql` | Jul 26 | yes |
| 023 | `023_event_package_management.sql` | Jul 26 | yes |
| 024 | `024_event_sales_expansion.sql` | Jul 26 | yes |
| 025 | `025_orchestration_observability.sql` | Jul 28 | yes |

No gaps in the numeric sequence (the earlier-documented "009 missing" finding from an older audit pass, `audit/migrations.csv`, is stale — 009 exists now, written Jul 15, and its own content confirms it's the previously-drafted-but-undocumented-objects migration referenced in `audit/CURRENT_STATUS.md`'s 2026-07-11 entry).

**A pattern worth noting for the confidence grading in §2:** 001–010 (excluding 004, 009) were written in May, well before this project's current tooling/testing discipline existed — consistent with "predates this tooling, presumed live." But 011 was written the *same day* (Jul 15) as 012/013, which are the two migrations with the strongest, most repeatedly-confirmed evidence of **not** being live. Age alone doesn't prove 011 is live just because it's numbered before 012 — it's dated identically to migrations we know for certain aren't.

---

## 2. Repository files vs. live migration tracking — and a structural finding first

**This project has no migration tracking table.** Confirmed by direct inspection: no `supabase/config.toml` (would exist if the Supabase CLI's own migration system were in use), no file anywhere in `supabase/`, `scripts/`, or `src/` references `schema_migrations`, `supabase_migrations`, or any custom tracking table. Migrations here are raw `.sql` files applied by hand (`psql` or the Supabase SQL Editor) or via the one custom script that exists (`scripts/apply-v3-migrations.mjs`, covering only 012/013) — there is no automatic record anywhere of which files have actually been run against production.

This means objective 2 as literally stated — "compare migration files against the tracking table in Supabase" — **cannot be done, because that table doesn't exist.** Two real options going forward, presented for a decision, not applied here (no code changes):

- **(a) Adopt one.** Create a simple `schema_migrations(version text primary key, applied_at timestamptz)` table, backfill it once by hand based on the live-schema query below, and have `apply-v3-migrations.mjs` (or its successor covering 014–024) insert a row per file it successfully runs. This is the only way future sessions — sandboxed or not — can ever get a real answer to "what's applied" without a live query.
- **(b) Keep querying `information_schema` directly**, accepting that "applied" can only ever be inferred from "does the table/column/constraint this migration creates actually exist," not from an explicit log. Workable, already how every prior audit in this repo (`LIVE_SCHEMA_AUDIT.md`, `SCHEMA_DRIFT_REPORT.md`) has done it — but can't distinguish "never run" from "ran and something after it failed," and can't detect a partially-applied multi-statement migration at all.

### The comparison, using what evidence actually exists (repository-only — run the live query below to convert this from evidence-graded to confirmed)

| # | Applied | Missing | Failed | Out-of-order | Evidence |
|---|---|---|---|---|---|
| 001–003, 006–008, 010 | Presumed | — | — | — | Written May 2026, predates this project's current audit tooling; no contrary evidence found in any session's documented findings |
| 004 | — | **Suspected missing** | — | — | `RELEASE_BLOCKERS.md`: three independent pieces of evidence across separate sessions suggest it was never applied. `/campaigns` would 500 outright if so (does not degrade gracefully) |
| 005, 009 | Presumed | — | Possibly (009 specifically) | — | 009 was explicitly described in `audit/CURRENT_STATUS.md` (2026-07-11) as "drafted... still awaits the user running it in the Supabase SQL Editor" — i.e. as of that entry it was NOT yet applied. No later session confirms it was subsequently run. Treat as **unverified, lower confidence than 001–008/010** |
| 011 | Unverified | Possibly | — | — | Written same day as 012/013 (confirmed not live) — the "presumes-live" reasoning that covers 001–010 is weaker here |
| 012–013 | — | **Confirmed missing** | — | — | Repeatedly re-verified across 8+ consecutive engineering sessions (Sprint 3 through this one); `MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` is the authoritative record |
| 014–023, 025 | Unverified | Likely, see §4 | — | — | No independent evidence either way; `PRODUCTION_MIGRATION_CHECKLIST.md` groups these with 012–013 as "pending," but see the script-coverage finding in §5 — that grouping was never actually acted on by any tooling |
| 016, 017, 024 | — | **Missing, with confirmed live symptoms if so** | — | — | See §4 — these three have documented root-cause investigations describing exact production bugs consistent with the migration being absent |
| Out-of-order | N/A | — | — | **None found structurally** | `PRODUCTION_MIGRATION_CHECKLIST.md`'s dependency review: every `REFERENCES` clause across all 25 files resolves to a table created earlier in the same file or an earlier-numbered migration — no forward references, no circular dependencies, confirmed by direct grep this pass on 016/017/024 specifically (all pure `ALTER TABLE ... DROP/ADD CONSTRAINT`, no new table dependencies) |
| Failed (partial application) | N/A | — | **Cannot be determined without a live query** | — | No tracking mechanism exists (see above) to distinguish "never run" from "ran and errored midway." Every 012+ migration wraps its DDL in `BEGIN`/`COMMIT` or `DO $$ ... END $$` blocks (confirmed for 016 and 024 above), which limits — but doesn't eliminate — partial-application risk |

### The one live query that resolves every "unverified"/"presumed" row above

Run in the Supabase SQL Editor (or via `psql`, from a machine with real access):

```sql
-- Existence check: one row per migration-created object, per migration.
select
  'leads_source_check has proposal'   as check_name,
  exists (select 1 from pg_constraint where conname = 'leads_source_check'
          and pg_get_constraintdef(oid) like '%proposal%')               as present
union all
select 'leads_source_check has excel_import',
  exists (select 1 from pg_constraint where conname = 'leads_source_check'
          and pg_get_constraintdef(oid) like '%excel_import%')
union all
select 'ai_interaction_log allows event_sales_advisor',
  exists (select 1 from pg_constraint where conname = 'ai_interaction_log_interaction_type_check'
          and pg_get_constraintdef(oid) like '%event_sales_advisor%')
union all
select 'broadcast_campaigns exists (004)',
  exists (select 1 from information_schema.tables where table_name = 'broadcast_campaigns')
union all
select 'reservations exists (012)',
  exists (select 1 from information_schema.tables where table_name = 'reservations')
union all
select 'social_accounts exists (014)',
  exists (select 1 from information_schema.tables where table_name = 'social_accounts')
union all
select 'admin_audit_log exists (015)',
  exists (select 1 from information_schema.tables where table_name = 'admin_audit_log')
union all
select 'stage_transitions exists (019)',
  exists (select 1 from information_schema.tables where table_name = 'stage_transitions')
union all
select 'orchestration_decisions exists (025)',
  exists (select 1 from information_schema.tables where table_name = 'orchestration_decisions');
```

`false` on any row = that migration (or the specific change it made) is missing. This single query settles §2's entire "unverified" column in one round trip — far more decisive than continuing to reason about file ages.

---

## 3. Report format

Delivered as the table in §2 above — Applied / Missing / Failed / Out-of-order columns, each cell graded by evidence source, not asserted as fact where no live-DB evidence exists.

---

## 4. Are migrations 012–024 actually required?

Not uniformly — they fall into three real categories, verified this pass by checking whether the application code that depends on each migration is itself live/reachable (not just "the table would be nice to have"):

**Required — confirmed active code paths depend on them, with documented production symptoms if absent:**

- **012–013.** The entire Reservation Platform (`availability-service.ts`, `reservation-service.ts`, `reservation-workflow.ts`, Sprint 1's manual-block feature, the Reservation Dashboard) reads/writes these tables. Without them, every one of those code paths either 502s (`POST /api/reservations`) or shows an all-zero dashboard — not a silent failure, but a fully non-functional feature area.
- **016.** `proposal-service.ts:191` actively writes `leads.source = 'proposal'` in the standalone-proposal-for-new-customer flow. Migration 016's own header documents the exact confirmed bug if it's missing: the insert throws a Postgres `check_violation`, `ensureLeadForProposal()` fails open by design and returns `null`, and the proposal is created with `lead_id = NULL` — **invisible on the Customers page.** This is describing an already-shipped feature, not a future risk.
- **017.** `src/app/api/leads/import/route.ts` writes `leads.source = 'excel_import'` as its default. Migration 017's own header documents: without it, "every Lead Import insert has therefore been throwing a Postgres check_violation... 100% of the time," with the error only `console.log`'d — the API still returns `success: true` and the UI shows "Import Complete" with **zero leads actually written.** This is the most severe finding in this whole review if still unapplied: a feature that appears to work and silently does nothing.
- **024.** `operator-assistant.ts` (`logInteraction`, line 313) actively writes `ai_interaction_log` rows with `interaction_type = 'event_sales_advisor'`, and `'upsell_recommendations'` is a live, reachable action in `validation.ts`'s operator-assist schema. Migration 024's own header confirms: without it, every write of those two interaction types "has been failing the CHECK constraint and silently swallowed" — the AI Event Sales Advisor and Upsell Recommendations features run and appear to work, but their interaction history silently never gets logged.

**Situationally required — only matter if a specific, currently-optional feature is turned on:**

- **004, 020–022.** Only matter if `/campaigns` is in scope for this release. 020/021 further depend on 004 already being live (020's own note: "Fixes a real bug: the Campaigns UI already offers birthday/anniversary/dormant... types that migration 004's original CHECK rejects" — confirmed this pass, `campaigns/page.tsx` does offer those types, so if 004 is applied without 020, that specific bug is live).
- **014.** Social module — confirmed credential-gated (`ENVIRONMENT_VARIABLES.md`: `isConfigured()` checks `META_PAGE_ACCESS_TOKEN` + `META_APP_SECRET`); safe to leave unmigrated as long as those env vars stay unset.
- **015.** `admin_audit_log` — per `PRODUCTION_MIGRATION_CHECKLIST.md`, "currently only wired into `POST /api/leads/import`." Small, contained blast radius.
- **018.** Additive columns supporting customer bulk-import — degrades to those fields being absent/null, not a hard failure, unless some `SELECT *`-based code path assumes the columns exist (not checked further this pass — low risk, additive-only).
- **025.** `orchestration_decisions` — required only if `settings.orchestration.enabled` is ever turned on (default `false`; Sprint 1 didn't change this default). Not required for this release.

**Low-risk / additive, no confirmed dependent live bug found:**

- **019, 023.** 019 (`stage_transitions`) explicitly "degrades to `null`, not a fake number" per the checklist if missing. 023 alters `packages`/`proposals` for the Smart Proposal Generator's package safe-fill — additive columns, no confirmed silent-failure code path found this pass (would need the same grep-for-active-writer treatment given to 016/017/024 above to fully rule out; not done here given the scope of this review, flagged as a follow-up if time allows before go-live).

**Bottom line for objective 4:** 012, 013, 016, 017, and 024 are the ones to treat as required, not optional, for this release — three of those five (016, 017, 024) aren't even about new functionality, they're fixing silent failures in features that already shipped. 004/020–022 are required only if Campaigns is in scope. 014/015/018/019/023/025 are safe to defer without a confirmed active bug.

---

## 5. Resolving the `PRODUCTION_MIGRATION_CHECKLIST.md` vs. `apply-v3-migrations.mjs` discrepancy

Re-confirmed this pass, same finding as the RC1 report: `PRODUCTION_MIGRATION_CHECKLIST.md` §"Pre-migration checklist" step 3 instructs using `npm run db:migrate:v3` for the full 012–024 batch; `scripts/apply-v3-migrations.mjs`'s `FORWARD_FILES` array contains only `012_v3_foundation_schema.sql` and `013_proposal_reservation_links.sql`. The doc's own claim ("safe to run in a single batch... via the existing script") is incorrect as written — the script silently won't touch 014–024, and running it will not error or warn that it only did part of the job.

**Resolution (decision + procedure, no code changed per instruction):**

Given §4's finding that 016/017/024 specifically are required (not merely "nice to have, grouped with the rest"), the correct sequence separates **012–013** (already has real tooling) from **014–024** (currently hand-apply only) rather than treating "012–024" as one homogeneous batch, as follows:

1. Run `npm run db:migrate:v3` for 012–013 (existing, tested, idempotent script — no change needed).
2. Apply 014–024 **by hand**, via the Supabase SQL Editor, **in numeric order**, respecting the two real dependency chains already documented in `PRODUCTION_MIGRATION_CHECKLIST.md`'s table (020→021→022, and 016→017 both extend the same constraint sequentially): `014, 015, 016, 017, 018, 019, 020, 021, 022, 023, 024`. Every file has a `_ROLLBACK.sql` pair and is additive/idempotent by the same structural review already performed (`IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` patterns throughout, confirmed again this pass on 016/017/024).
3. Separately, decide whether to extend `apply-v3-migrations.mjs`'s arrays to cover 014–024 so this doesn't stay a manual step for the *next* release too — a real follow-up, but a code change, so not done as part of this verification-only pass.
4. `npm run db:smoke-test:v3` only verifies 012/013 (its own `RLS_TABLES` comment: "every migration-012 table") — it will report success even if 014–024 are still missing. Don't treat a clean `db:smoke-test:v3` run as proof that 014–024 landed.

---

## 6. Recommended deployment sequence

1. Take a database backup / confirm Supabase's automatic backup is current.
2. Run the §2 live-query against production. Record exactly which objects are missing — don't assume the file-age groupings above are still accurate by the time you run this.
3. Apply, in this order, whatever the query shows as missing:
   - `004` (if Campaigns is in scope for this release) — `psql -f supabase/migrations/004_phase4_campaigns.sql`.
   - `012` → `013` — `npm run db:migrate:v3`, then `npm run db:smoke-test:v3`.
   - `014` → `015` → `016` → `017` → `018` → `019` → (`020` → `021` → `022`, only if 004 is in scope) → `023` → `024` → `025` (only if orchestration is being enabled this release) — by hand, SQL Editor, one at a time, confirming each with its own migration file's "POST-FLIGHT" verification query where one is included (016/017 both have one).
4. Manually spot-check the two highest-severity fixes from §4: create a lead via Lead Import (Excel) and confirm it's actually written (017); create a proposal for a brand-new customer with no existing lead and confirm the resulting lead is visible on the Customers page (016).
5. Proceed with the rest of `RC1_DEPLOYMENT_READINESS.md`'s deployment checklist (env vars, deploy, webhooks, cron, post-deploy verification) — unchanged by this review.

No code was modified to produce this document.
