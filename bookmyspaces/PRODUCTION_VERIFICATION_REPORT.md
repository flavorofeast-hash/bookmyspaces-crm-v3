# Production Database Verification Report — RC2 Phase 2

Written 2026-08-01 on `release/v1.0.0-rc2`. Verification only — no feature work, no redesign, no business logic touched. This document consolidates and extends prior audit work (`audit/PRODUCTION_MIGRATION_STATE_VERIFICATION.md`, `audit/SCHEMA_DRIFT_REPORT.md`, `audit/LIVE_SCHEMA_AUDIT.md`, `audit/MIGRATION_023_DEPLOYMENT_REVIEW.md`/`024_DEPLOYMENT_REVIEW.md`, `docs/engineering/MASTER_DATABASE.md`, ENG-001 through ENG-004 in `MASTER_BACKLOG.md`) rather than re-deriving any of it. What's new in this pass: a fresh, reproducible connectivity check, and two migrations (026, 027) that no prior audit ever covered — including 027, the single most consequential unverified migration found so far, because the entire Site Visit → Proposal pipeline validated last pass depends on it.

> **Addendum, 2026-08-01 (RC2 Final / Release Preparation pass) — corrects §3's original "Package" grade, does not silently overwrite it.** A closer read of `docs/engineering/MASTER_DATABASE.md`'s opening section (present in this repo the whole time, under-weighted in the original pass) records a confirmed RC1-session finding: the live `packages` table's actual columns (`slug, property, type, price, price_note, duration, capacity_min, capacity_max, sort_order, ...`) did **not** match what migrations 007/023/024 describe (`venue, tier, base_price, max_guests, duration_hours, description, ai_description`). The original §3 Package grade ("Yellow — `select('*')` limits blast radius to missing metadata") is **wrong for this specific case**: `select('*')` protects against *missing* columns, not *renamed* ones. `package-service.ts`'s `mapPackageRow()` reads `row.venue`/`row.base_price`/`row.max_guests` by name — if the live table genuinely uses `property`/`price`/`capacity_max` instead, every package silently maps to `venue: undefined`, `basePrice: 0`, `maxGuests: 60` (its hardcoded default). That is not a metadata gap: `venue: undefined` means the Skyline-never-events and Monurama-100-cap guards in `auto-package-recommendation.ts` (`if (pkg.venue && ...)`) **silently never fire**, and `basePrice: 0` means every AI-drafted proposal computes at ~₹0 plus addons. **Updated grade: CRITICAL**, superseding §3/§4's original Package/Pricing entries below (left in place, not deleted, per this project's own non-silent-overwrite convention). Exact verification SQL: `scripts/verify-packages-columns.sql`, new this pass — checks both the expected and the RC1-documented alternate column names in one query so a single run resolves whether this drift is still current.

---

## 0. Connectivity check performed this pass (new evidence, not carried forward)

Every prior session in this project's history reported "no network route to production Supabase," graded as presumed/re-confirmed but without a captured error. This pass got a definitive answer:

```
$ curl -sv -x http://localhost:3128 "https://nssteddtqgqubggpcwae.supabase.co/rest/v1/"
> CONNECT nssteddtqgqubggpcwae.supabase.co:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
< X-Proxy-Error: blocked-by-allowlist
```

This sandbox's outbound proxy has a **domain allowlist**, and `supabase.co` is not on it (confirmed separately: `registry.npmjs.org` succeeds through the same proxy, `google.com`/`api.github.com` also fail — this is allowlist-based, not a general outage). This is stronger evidence than a DNS timeout: it's an explicit policy decision on the proxy, not flaky connectivity. **Nothing in this report was checked against the live database.** Every "Production Schema" cell below is graded by the same evidence standard as every prior audit: repository evidence, prior sessions' documented live-query results (where a human ran one and pasted results back, e.g. `LIVE_SCHEMA_AUDIT.md`), and application code that depends on the object existing — never asserted as fact.

---

## 1. Pending migrations — Repository vs. Production

**Fully reused from `audit/PRODUCTION_MIGRATION_STATE_VERIFICATION.md` (2026-07-29) — not re-derived.** That document's §2 table remains the authoritative answer for migrations 001–025 and is not repeated here in full; its conclusion:

- **Confirmed applied (repository-only evidence, high confidence):** 001–003, 005–010 (presumed live, no contrary evidence in any session).
- **Confirmed NOT applied:** 012, 013 (Reservation Platform — re-verified across 8+ sessions).
- **Confirmed missing, with documented live symptoms:** 016, 017, 024 — each has a named, specific silent-failure bug if absent (016: standalone proposals get `lead_id = NULL`; 017: Lead Import via Excel silently writes zero leads; 024: AI interaction logging for two action types silently swallowed).
- **Suspected missing:** 004 (three independent pieces of evidence).
- **Unverified, no contrary or confirming evidence:** 011, 014, 015, 018–023, 025.

### New this pass: migrations 026 and 027 — never previously checked

Neither appears in `MASTER_DATABASE.md`'s migration inventory table (stops at 025) or in any audit document. Repository evidence only (no live check possible):

| # | What it adds | Repository dependents | Failure mode if missing |
|---|---|---|---|
| **027** | `follow_ups.property/purpose/guest_count/budget` + `idx_follow_ups_type_scheduled_at` | `scheduleSiteVisit()` (`site-visit-service.ts`) — a **named-column INSERT**, not `SELECT *` | **Hard failure, not degradation.** Every site-visit request (AI chat confirming a visit, or `/visits/new`) throws a Postgres `column does not exist` error and the visit is never created. This would silently break the entire Sprint 1/2 pipeline just validated in `RC2_READINESS_REPORT.md` — Journeys 1, 2, 4, 7 all depend on this migration being live. |
| **026** | `leads.campaign/landing_page/utm_source/utm_medium/utm_campaign/referral` | Campaign Landing Page attribution capture (Sprint 1) | Same class of failure as 027 if any writer uses named-column INSERT with these fields — lower blast radius (attribution data only, not the core booking pipeline) but not checked further this pass; flagged for the same live verification. |

**This is the single most important finding in this report.** 027 is newer than every migration any prior audit considered, was written and shipped in the same engineering arc as the code that depends on it, and has never once been checked against production. Given ENG-001/012-013's history in this project (a dependent feature shipped and tested for months while its migration silently never landed), the same failure mode is live-risk-equivalent here until checked.

**Exact SQL to resolve:** `scripts/verify-migrations-026-027.sql` (written this pass, same read-only `information_schema`-only pattern as the existing 023/024 verification scripts). Paste into the Supabase SQL Editor; returns PASS/FAIL per migration plus per-object detail.

**Exact fix if FAIL:** apply the migration file directly — `supabase/migrations/027_site_visit_fields.sql` (and `026_campaign_landing_attribution.sql` if that one also fails), both plain `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, idempotent, additive-only, paired `_ROLLBACK.sql` files already exist for both.

**Exact risk:** none from applying — both are additive, idempotent, nullable-column-only migrations, safe to run any number of times. The risk is entirely in *not* applying 027 before relying on the Sprint 1/2 pipeline in production.

---

## 2. Schema drift — Repository vs. Live Database

**Fully reused from `audit/SCHEMA_DRIFT_REPORT.md` and `audit/LIVE_SCHEMA_AUDIT.md`** (live snapshot captured 2026-07-11 via a real SQL Editor query the user ran and pasted back — the only genuine live-database evidence anywhere in this project's history). Not re-derived; **explicitly noted as stale**: captured before migrations 011–027 existed, so it cannot speak to anything those add — only to 001–010's live state, where real drift was found:

- **10 tables live with no corresponding migration** (`activity_events`, `invoices`, `lead_imports`, `messages`, `payments`, `scheduled_jobs`, `system_health_log`, `user_profiles`, `whatsapp_conversations`, `whatsapp_messages`) — production-quality, actively used by shipped features, most likely from an undocumented migration 009 predecessor.
- **8 tables in migrations, not live** (`ai_summaries`, `blocked_dates`, `broadcast_campaigns`, `documents`, `festival_calendar`, `message_queue`, `notification_settings`, `staff_performance`).
- **9 confirmed `leads` columns live with no migration**, most consequentially `leads.lead_stage` — the column this project's entire Sprint 2/3A Opportunity Score and Founder Dashboard work (validated last pass) is built on. **Confirmed live** as of the 2026-07-11 snapshot, which is reassuring, but that snapshot is now three weeks old relative to today and was never re-checked since.
- **RLS gaps:** `analytics_events` and `follow_ups` have RLS enabled with **zero policies** — effectively deny-all except `service_role` (which every server-side function in this codebase uses, so not a functional blocker, but worth knowing before any client-side/session-scoped query is ever added against either table).

**Nothing new was found this pass** on repository-vs-live schema drift beyond what §1 already surfaces for 026/027 — this section is a citation, not new work, per "do not duplicate verification."

---

## 3. Module-by-module verification

For each module: **Repository Schema** (what the migration files define), **Production Schema** (best available evidence — live-checked, presumed, or confirmed-missing), **Migration State**, **Application Assumptions** (what the current code actually reads/writes).

### Reservations

- **Repository Schema:** `reservations`, `inventory_items`, `rate_plans`, `meal_plans`, `addon_services` (migration 012), FK links from `proposals`/`invoices` (013).
- **Production Schema:** **Confirmed NOT present** (§1, high confidence, re-verified across 8+ sessions).
- **Migration State:** 012/013 not applied.
- **Application Assumptions:** `availability-service.ts`, `reservation-service.ts`, `reservation-workflow.ts`, the Reservation Dashboard, and `reservation-to-proposal.integration.test.ts` (validated last pass, against a mock) all assume these tables exist.
- **Grade: CRITICAL.** Every reservation-creating code path either 502s or shows an all-zero dashboard in production today, if 012/013 genuinely aren't live. Unchanged conclusion from every prior audit — restated, not re-investigated.

### Pricing

Two independent pricing surfaces with different states:

- **Event package pricing** (Silver/Gold/Platinum — what Sprint 2's `runAutoPackageRecommendation` prices proposals from): reads `packages.base_price` (migration 007, **presumed live**) plus `packages.hall`/`addon_service_ids` (migration 024, **unverified**) via `getPackageById()`'s `select('*')`. Because it's `SELECT *` rather than named columns, **this degrades gracefully** — if 024 hasn't landed, `pkg.hall`/`pkg.addonServiceIds` simply come back `null`/`undefined`, not an error; proposals still draft, just with thinner package metadata (no hall assignment, no addon service references). Grade: **Yellow, not Critical** — different failure mode than 027's hard-fail INSERT pattern.
- **Reservation pricing** (`rate_plans`, migration 012): **Confirmed NOT present** (same as Reservations above), compounded by the still-open **ENG-004** (reservation-pricing-zeroing bug, Critical, blocked on ENG-001/003 per `MASTER_BACKLOG.md`) — even once 012 lands, this specific bug needs independent resolution. **Grade: CRITICAL**, unchanged from `MASTER_BACKLOG.md`.

### Proposal

- **Repository Schema:** `proposals` (migration 003) + `escalation_required` (010) + `reservation_id`/`package_id` (013) + `package_id` again, redundantly-but-harmlessly (023) + `hall`/`addon_service_ids` (024, via `packages`, referenced not stored).
- **Production Schema:** core table **confirmed live**, 66 columns per the 2026-07-11 snapshot. `package_id`/`reservation_id` presence is **ambiguous between 013 and 023** per `MIGRATION_023_DEPLOYMENT_REVIEW.md` §3 — restated here, not re-derived.
- **Migration State:** core table live; 013/023 status unverified but low-risk either way (redundant `IF NOT EXISTS` additions).
- **Application Assumptions:** `runAutoPackageRecommendation` (validated last pass) inserts `package_id`, `hall`, `addon_service_ids`, `share_token` — all either confirmed-live columns or degrade-gracefully-null ones per the Pricing section above.
- **Grade: Yellow.** Core table sound; package-metadata columns unverified but non-fatal if absent.

### Package

- **Repository Schema:** `packages` (007) + five columns (023) + five more (024, including `hall`/`addon_service_ids` that Sprint 2's proposal-drafting code reads).
- **Production Schema:** table **confirmed live** (2026-07-11 snapshot, RLS with 2 policies — public read where `is_active`, authenticated manage). **Confirmed drift already found on this table** (`MASTER_DATABASE.md`'s explicit note) — the exact nature of the drift (which columns differ) isn't detailed in any surviving document; only that 023/024's column additions are "exactly what's been found to not match the live table."
- **Migration State:** table live; 023/024 extensions unverified, with a documented history of drift specifically on this table.
- **Application Assumptions:** `package-service.ts` uses `select('*')` throughout — the one place in this module list where that pattern actively protects against drift, per the Pricing section's finding.
- **Grade: Yellow — known drift history, but the code's `select('*')` pattern limits blast radius to "missing metadata," not "hard failure."** — **SUPERSEDED, see the dated addendum at the top of this document. Updated grade: CRITICAL.** The drift is column-*rename*, not column-*absence*; `select('*')` does not protect against a renamed column being read under its old name. Exact SQL: `scripts/verify-packages-columns.sql`.

### Lead

- **Repository Schema:** `leads` (001) + assorted extensions across 008, 010, 016 (retired, never applied — see `MASTER_DATABASE.md`), 017, 026.
- **Production Schema:** table **confirmed live**; 9 columns confirmed live with **no corresponding migration at all** (`SCHEMA_DRIFT_REPORT.md` Category C), including `lead_stage` — load-bearing for every Sprint 2/3A calculation validated last pass.
- **Migration State:** core table + `lead_stage` confirmed live as of 2026-07-11; 026 (campaign attribution) unverified, new this pass.
- **Application Assumptions:** `opportunity-score.ts`, `lead-intelligence.ts`, `revenue-intelligence.ts` all filter/group by `lead_stage` — confirmed-live, low risk. `chat/route.ts`'s campaign-context lead-seeding path (Sprint 1) would need 026's columns if it writes them by name — not re-checked this pass (out of scope; flagged under §1 alongside 027).
- **Grade: Green for the core columns this project's recent work depends on (`lead_stage` confirmed live); Yellow for 026, unverified.**

### Follow-up

- **Repository Schema:** `follow_ups` (007) + `property`/`purpose`/`guest_count`/`budget` (027, brand new, this session).
- **Production Schema:** core table **confirmed live** (2026-07-11 snapshot: RLS on, **zero policies** — `service_role` only, which is how every server-side caller in this codebase reaches it, so functionally fine). 027's four columns: **entirely unverified, never checked by any prior session.**
- **Migration State:** see §1 — this is the headline finding of this pass.
- **Application Assumptions:** `scheduleSiteVisit()` INSERTs these four columns by name — a hard-failure dependency, not a graceful one.
- **Grade: CRITICAL — new finding this pass.** Everything validated in last pass's `RC2_READINESS_REPORT.md` for Journeys 1, 2, 4, 7 depends on this migration being live, and it has never been checked.

### Founder Dashboard

- **Repository Schema:** no dedicated tables — by design (Sprint 3A's explicit "no new tables/duplicate calculations" mandate, honored). Reads `leads`, `proposals`, `follow_ups` only, through `revenue-intelligence.ts` and `opportunity-score.ts`.
- **Production Schema / Migration State:** entirely inherited from the Lead/Follow-up/Proposal grades above — no independent risk of its own.
- **Application Assumptions:** none beyond what those three modules already assume.
- **Grade: inherits Yellow (Proposal) / Green-with-one-Critical-dependency (Lead/Follow-up, via 027).** If 027 is missing, the dashboard's "Today's Schedule" timeline still renders (it degrades to an empty site-visit list, a `SELECT` not an `INSERT`) but the pipeline feeding it new visits is broken upstream.

---

## 4. Summary — Verified / Unknown / Mismatch / Critical / Ready

| Grade | Items |
|---|---|
| **Verified** (real live evidence exists, even if dated) | `leads` core table + `lead_stage` (2026-07-11 snapshot); `proposals` core table (66 cols, same snapshot); `packages` core table + RLS shape (same snapshot); `follow_ups` core table + RLS shape (same snapshot); migrations 012/013 confirmed NOT live (re-verified 8+ times); this pass's proxy-blocked connectivity (fresh, reproducible). |
| **Unknown** (no live evidence either way) | Migrations 011, 014, 015, 018–023, 025, and — new this pass — **026**; the exact nature of `packages`' documented column-level drift (which specific columns, never itemized in a surviving document). |
| **Mismatch** (repository and best-available production evidence actively disagree) | `packages`/`proposals` — 023/024's migration-file columns vs. the live table (documented, not re-derived); the 10 live-but-unmigrated tables and 9 live-but-unmigrated `leads` columns from `SCHEMA_DRIFT_REPORT.md` (as of 2026-07-11). |
| **Critical** | Migration **027** — new finding, hard-failure dependency of the entire Site Visit → Proposal pipeline validated last pass, never previously checked. **`packages` column-rename drift (venue/base_price/max_guests vs. property/price/capacity_max)** — added by the 2026-08-01 addendum above, upgraded from this document's original Yellow grade. Migrations 016/017/024's documented silent-failure bugs (carried forward, unchanged). Migrations 012/013 (Reservations, entire module non-functional if genuinely absent). ENG-004 (reservation pricing-zeroing, unresolved). |
| **Ready** | Lead capture/dedup, AI conversation, Package Recommendation guard logic, Opportunity Score, Revenue Intelligence, Founder Dashboard computation — all validated at the *application* layer last pass (`RC2_READINESS_REPORT.md`) and not dependent on any schema this report grades Critical, **except** Follow-up/Site-Visit scheduling specifically, which is Ready in code but blocked on 027's live status. |

---

## 5. Updated ENG status

| Ticket | Prior status | Updated status | Change |
|---|---|---|---|
| ENG-001 (migration 012/013 live status) | Open, Critical | **Open, Critical — unchanged** | No new evidence this pass (no live access). |
| ENG-002 (migration 004 live status) | Open, High | **Open, High — unchanged** | No new evidence this pass. |
| ENG-003 (schema drift re-verify) | Open, Critical | **Open, Critical — unchanged, scope confirmed larger than previously itemized** | This pass located the drift *claim*'s source (`MASTER_DATABASE.md`) but not a surviving itemization of exactly which `packages` columns differ — recommend the next session with live access run `scripts/verify-migration-023.sql`/`024` specifically to produce that itemization, since it doesn't currently exist as a checkable artifact. |
| ENG-004 (reservation pricing-zeroing bug) | Open, Critical | **Open, Critical — unchanged** | Depends on ENG-001/003; no progress possible without live access. |
| **ENG-033 (new, proposed this pass)** | — | **Open, Critical** | Verify migration 027 (`follow_ups` site-visit columns) against production before relying on the Site Visit → Proposal pipeline. Exact SQL: `scripts/verify-migrations-026-027.sql`. This is the highest-leverage single check available — one query resolves the largest currently-unknown risk to the just-validated revenue pipeline. |
| **ENG-034 (new, proposed this pass)** | — | **Open, Medium** | Verify migration 026 (`leads` campaign-attribution columns) against production. Same script as ENG-033. Lower priority — attribution data, not the core booking pipeline. |
| **ENG-035 (new, proposed 2026-08-01 addendum)** | — | **Open, Critical — highest-priority single item in this report** | Verify `packages.venue`/`base_price`/`max_guests` exist live, using the RC1-documented alternate names (`property`/`price`/`capacity_max`) as the alternate hypothesis to test in the same query. Exact SQL: `scripts/verify-packages-columns.sql`. If confirmed, the Property Intelligence guards (Skyline-never-events, Monurama-100-cap) are silently inert and every AI-drafted proposal prices near ₹0 in production right now — this is a revenue-and-safety-critical finding, not a cosmetic one, and supersedes ENG-003's original framing (schema drift generally) with a specific, actionable, single-table check. |

---

## 6. RC2 release recommendation

**READY WITH MINOR ISSUES as of the original 2026-08-01 pass — REVISED by the same-day addendum: two Critical checks (027, packages column drift) must both be run and resolved before this release ships, not treated as advisory.**

Application-layer logic remains fully validated (last pass, `RC2_READINESS_REPORT.md`). This report's original pass surfaced one previously-unknown database-state unknown (migration 027); the same-day addendum surfaces a second, arguably higher-severity one already documented elsewhere in the repo but never propagated into this report's grading. **Recommended sequencing before this release ships, in priority order:**

1. Run `scripts/verify-packages-columns.sql` against production — resolves whether the Property Intelligence guards and proposal pricing are currently safe or silently broken. **Do this first.**
2. Run `scripts/verify-migrations-026-027.sql` against production — resolves whether Site Visit scheduling can create a row at all.
3. If either check fails, apply the fix named in that check's own file (schema reconciliation for `packages`; `supabase/migrations/027_site_visit_fields.sql` for follow-ups) before trusting the AI chat widget, `/visits/new`, or the Catalog admin UI in production.
4. Separately, and not blocking this release per se: run the existing one-shot query in `RC1_DEPLOYMENT_READINESS.md` §1 and `PRODUCTION_MIGRATION_STATE_VERIFICATION.md` §2 to finally convert ENG-001–004 from "presumed"/"unverified" to fact — carried forward, unresolved, same recommendation as every prior audit in this project.

No application code was changed to produce this report or its addendum — only three new read-only, information_schema-only verification SQL files, which run nothing against application data and modify nothing.
