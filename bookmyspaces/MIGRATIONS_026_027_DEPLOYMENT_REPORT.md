# Migrations 026 & 027 — Deployment Safety Report

**Date:** 2026-08-02
**Mode:** Investigation only. No code changed. No SQL changed. No database touched.
**Trigger:** Operator-reported production verification — migration 026: 0/6 objects present; migration 027: 0/5 objects present. Neither migration has been applied to production.

Files read in full for this report: `supabase/migrations/026_campaign_landing_attribution.sql`, `026_campaign_landing_attribution_ROLLBACK.sql`, `027_site_visit_fields.sql`, `027_site_visit_fields_ROLLBACK.sql`, plus the two API/service call sites that write these columns (`src/app/api/campaigns/track/route.ts`, `src/lib/visits/site-visit-service.ts`) to ground the backfill and severity findings in actual code behavior.

**Object count cross-check:** migration 026 adds exactly 6 objects (`leads.campaign`, `.landing_page`, `.utm_source`, `.utm_medium`, `.utm_campaign`, `.referral`) — matches the reported "0/6". Migration 027 adds exactly 5 objects (`follow_ups.property`, `.purpose`, `.guest_count`, `.budget`, plus the partial index `idx_follow_ups_type_scheduled_at`) — matches the reported "0/5". This confirms the file contents below are the same ones the operator's verification ran against.

---

## 1. Safe to apply to a production database that already contains live data?

**Yes, both.** Full reasoning:

- **026** — `ALTER TABLE leads ADD COLUMN IF NOT EXISTS <6 columns>`, every column `TEXT`, no `DEFAULT`, no `NOT NULL`. Adding a nullable column with no default is a metadata-only operation in PostgreSQL (≥11) — it does not rewrite the table and does not scan existing rows. It takes a brief `ACCESS EXCLUSIVE` lock only for the instant it takes to update the catalog, not for the duration of a table scan. Safe on a live table of any size, including one under concurrent read/write traffic. Existing `leads` rows simply get `NULL` for all 6 new columns, which is the semantically correct state (attribution wasn't captured for them).
- **027** — Same reasoning for its 4 `ADD COLUMN IF NOT EXISTS` (all nullable, no default). The one structural difference is the `CREATE INDEX IF NOT EXISTS idx_follow_ups_type_scheduled_at ON follow_ups(type, scheduled_at) WHERE type = 'site_visit'` statement. This is a plain (non-`CONCURRENTLY`) index build, which takes a `SHARE` lock on `follow_ups` for the duration of the build — reads are unaffected, but `INSERT`/`UPDATE`/`DELETE` against `follow_ups` are blocked until the index finishes. This is a real but minor operational consideration, not a data-loss or correctness risk: `follow_ups` is a small-to-moderate operational table (follow-up tasks, not a high-volume event log), so the build should complete in well under a second even with a live table. Worth applying outside peak WhatsApp-follow-up-writing hours if the operator wants to be extra cautious, but not a blocker. (I have not modified this index to use `CONCURRENTLY` — that would be a SQL change, out of scope for this investigation-only mission; flagging it here as an observation only.)

Neither migration reads, joins against, or depends on live data content — both are pure schema additions, so there is no scenario where existing row values could cause either migration to fail or behave unexpectedly.

---

## 2. No destructive ALTER/DROP statements?

**Confirmed — the forward migrations contain zero `DROP`/destructive statements.**

- `026_campaign_landing_attribution.sql`: one `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement (6 columns). Nothing else.
- `027_site_visit_fields.sql`: one `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement (4 columns), one `CREATE INDEX IF NOT EXISTS`, four `COMMENT ON COLUMN` statements. Nothing else.

Both paired `_ROLLBACK.sql` files do contain `DROP COLUMN`/`DROP INDEX` — that is expected and correct: undoing an additive migration necessarily means dropping what it added. This is not a concern for the forward-deploy path this report is about, but it is worth flagging under Risks (§9) that running either rollback *after* real data has been written into these new columns would permanently discard that data — inherent to any rollback of an additive-column migration, not a defect.

---

## 3. No data loss?

**Confirmed for the forward migrations.** Purely additive `ADD COLUMN` statements never modify or remove existing column data; every pre-existing `leads`/`follow_ups` row is untouched except for gaining new columns populated with `NULL`. No `UPDATE`, `DELETE`, `TRUNCATE`, or type-changing `ALTER COLUMN` appears in either file.

The only data-loss vector in scope at all is the *rollback* path (see §2/§9) — not the deployment this report is scoping.

---

## 4. Idempotent behavior?

**Confirmed for both, though via two different mechanisms:**

- **026**: all 6 `ADD COLUMN` clauses use `IF NOT EXISTS` — re-running the whole file after a successful (or partially successful) prior run is a guaranteed no-op for columns that already exist, and won't error.
- **027**: the 4 `ADD COLUMN` clauses use `IF NOT EXISTS`, and the index uses `CREATE INDEX IF NOT EXISTS` — both guarded the same way. The four `COMMENT ON COLUMN` statements are **not** wrapped in any conditional guard, but this doesn't break idempotency: `COMMENT ON` in PostgreSQL is an unconditional "set the comment to this text" operation, not an "add" operation — it never errors on a second run, and running it twice with the same text leaves the database in the identical state either time. So the absence of a guard there is a non-issue, not a gap.

Both rollback files are equally idempotent (`DROP COLUMN IF EXISTS`, `DROP INDEX IF EXISTS`).

**Net: both migrations are safe to re-run any number of times**, including a partial-failure-then-retry scenario (e.g. if 027's index build were interrupted, re-running the file would simply pick up where it left off rather than erroring on the columns that already landed).

---

## 5 & 6. Correct deployment order — must 026 precede 027?

**No functional/technical dependency exists between them.** 026 touches only `leads`; 027 touches only `follow_ups`. Neither file references the other's table, column, or any object the other creates — no foreign key, no shared index, no shared function. They could technically be applied in either order, or even concurrently by two separate sessions, without either one failing or behaving differently.

**Recommended order: 026 before 027 anyway**, for two reasons that are about process hygiene, not correctness:
1. It matches the sequential numbering convention this repo's `MASTER_DATABASE.md` migration inventory already documents and relies on — keeping "migrations applied through N" a well-defined, ordered statement avoids ambiguity in that ledger going forward.
2. Both are part of the same Sprint 1 (Revenue Capture Pipeline) feature arc per their own file headers — 026 captures how a lead arrived (landing page attribution), 027 captures the site-visit step that follows lead capture in that same pipeline. Applying them in pipeline order, while not required by the SQL itself, keeps the deployment narrative coherent with the feature story.

---

## 7. Do either migration depend on 028?

**No.** Migration 028 (`028_reconcile_packages_schema_drift.sql`, confirmed live 2026-08-02) touches only 3 columns on the `packages` table (`property`→`venue`, `price`→`base_price`, `capacity_max`→`max_guests`). Neither 026 nor 027 references `packages` in any way — no shared table, no FK, no column name collision, no ordering requirement in either direction. All three migrations (026, 027, 028) are structurally independent of one another and can be reasoned about, applied, and rolled back in isolation.

---

## 8. Manual backfill recommended after applying them?

**026 (`leads` attribution columns): No backfill recommended, and none is meaningfully possible.** These 6 columns capture attribution data (UTM parameters, landing page, referral) at the moment a visitor lands on a campaign page and is captured via `POST /api/campaigns/track` (`src/app/api/campaigns/track/route.ts`). For any `leads` row created before this capture flow existed, that attribution context was never recorded anywhere else in the schema — there is no other column or table this data could be reconstructed from. `NULL` is the correct, honest representation of "attribution unknown" for those historical rows, not a gap to be filled in.

**027 (`follow_ups` site-visit columns): No backfill required for the same reason** — `property`/`purpose`/`guest_count`/`budget` are captured by `scheduleSiteVisit()` (`src/lib/visits/site-visit-service.ts`) only at the moment a site visit is scheduled through the dedicated Site Visit Scheduling feature (Sprint 1, migration 027's own companion feature). One partial exception worth a human decision rather than an automatic backfill: if any pre-existing `follow_ups` rows already have `type = 'site_visit'` (the `type` CHECK constraint has allowed this value since migration 007, per 027's own header comment — "this value has simply never had a writer until now"), those rows' `guest_count` *could* be approximately backfilled from the linked lead's `leads.guest_count` after 027 lands, since that relationship already exists via `follow_ups.lead_id`. `property`/`purpose`/`budget` have no equally reliable source to backfill from. This is optional, low-stakes (historical record enrichment, not a live-flow blocker), and I'd recommend checking `SELECT count(*) FROM follow_ups WHERE type = 'site_visit'` after 027 applies before deciding whether it's even worth doing — if the count is 0 (likely, since no writer has ever targeted this type before 027's own feature), there's nothing to backfill.

---

## 9. Additional risk note — these migrations are currently blocking live functionality

Not one of the 8 requested checks, but directly relevant to deployment urgency: tracing the application code that writes these columns shows **both migrations are currently gating real, currently-broken production functionality**, not just future-proofing:

- **`/api/campaigns/track`** (026) — the route's own inline comment documents that its `leads` insert already includes `campaign`/`landing_page`/`utm_source`/`utm_medium`/`utm_campaign`/`referral` by name in a single `INSERT`. Without migration 026 live, that `INSERT` fails outright (unknown column), the route's `try/catch` logs the error and returns HTTP 500, and **the campaign landing pages (`/wedding`, `/birthday`, `/corporate`, `/airport-stay`, `/staycation`) are not capturing any leads via this path today.** This is a hard failure, not a graceful degradation — the entire lead row fails to insert, not just the 6 attribution fields.
- **`scheduleSiteVisit()`** (027) — `src/lib/visits/site-visit-service.ts` `INSERT`s `property`/`purpose`/`guest_count`/`budget` into `follow_ups` by name. Without migration 027 live, every call to schedule a site visit (the `/visits/new` page, and any other caller of this service) fails outright the same way — already flagged as a known open risk in `MASTER_DATABASE.md`'s migration 027 row before this report.

This means the two checks this report is scoped to aren't just "is it safe to apply" — applying them also **fixes two currently-live production breakages**. Framed as a risk: the longer these stay unapplied, the more real campaign-landing-page visitors and site-visit-scheduling attempts are silently failing.

---

## 10. Recommended deployment order (summary)

1. Apply `026_campaign_landing_attribution.sql`.
2. Apply `027_site_visit_fields.sql`.
   (Either order is technically safe per §5/§6; this order matches the pipeline story and the existing migration-inventory numbering.)
3. Re-run whatever verification the operator used to produce the "0/6 objects" / "0/5 objects" result, expecting 6/6 and 5/5 respectively.
4. Optional, low-priority: `SELECT count(*) FROM follow_ups WHERE type = 'site_visit'` — only pursue the partial `guest_count` backfill described in §8 if this is non-zero.
5. No code changes are needed for either migration — `src/app/api/campaigns/track/route.ts` and `src/lib/visits/site-visit-service.ts` already write these columns by name and will simply start succeeding once the columns exist.

**No SQL, code, or database changes were made in the course of producing this report**, per the mission's explicit read-only scope.
