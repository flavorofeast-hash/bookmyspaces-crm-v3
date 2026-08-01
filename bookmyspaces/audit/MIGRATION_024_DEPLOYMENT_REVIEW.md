# Migration 024 — Deployment Readiness Review

Written 2026-07-29, RC1 mode, after live verification confirmed 012/013/016/017 PASS and **024 FAIL** against production. Review only — `supabase/migrations/024_event_sales_expansion.sql` and its paired `024_event_sales_expansion_ROLLBACK.sql` were read in full for this; neither file was modified, and no new migration was written.

---

## 1. Every schema change, explained

Four changes, all against tables that already exist live (`packages` since migration 007, `proposals` since migration 003, `ai_interaction_log` since migration 012 — the last one now confirmed live by this session's verification):

**(a) Five new nullable columns on `packages`:**
- `hall TEXT` — which physical hall/venue space a package is tied to, so accepted proposals can be grouped "by Hall" on the Event Revenue Dashboard the same way they're already grouped by venue/package/event_type.
- `seating_style TEXT` — free-text seating configuration.
- `addon_service_ids UUID[] DEFAULT '{}'` — references `addon_services(id)` (migration 012), not DB-enforced (Postgres can't FK into an array column), validated app-side in `package-service.ts`. Same convention already used by `proposals.addon_service_ids` (migration 013).
- `seasonal_pricing JSONB DEFAULT '[]'` — array of `{label, startDate, endDate, priceAdjustmentPct}` rules, applied app-side; `base_price` itself is never mutated by a rule.
- `standard_discount_pct NUMERIC(5,2)` — a catalog-level discount hint the Smart Proposal Generator can pre-fill; a proposal's own `discount_amount`/`discount_reason` (migration 003) remain the actual negotiated value and are never overwritten by this.

Plus one index: `idx_packages_hall`.

**(b) One new nullable column on `proposals`:** `hall TEXT`, mirroring `packages.hall` for the same Event Revenue Dashboard grouping. Plus `idx_proposals_hall`.

**(c) `ai_interaction_log.interaction_type`'s CHECK constraint is replaced** (drop-then-recreate, inside a `DO $$ ... END $$` block) to add two values — `'upsell_recommendations'` and `'event_sales_advisor'` — to the existing 7-value allow-list, for a total of 9. This is the one non-purely-additive-looking statement in the file — see §3.

**Nothing else.** No new tables, no data backfill/UPDATE, no triggers, no RLS changes (not needed — `packages`, `proposals`, and `ai_interaction_log` already have RLS enabled from their original migrations).

---

## 2. Is every change additive?

**(a) and (b) — yes, unambiguously.** Every `ADD COLUMN` uses `IF NOT EXISTS`, every new column is nullable (no `NOT NULL`, no non-constant default requiring a table rewrite), and both new indexes use `IF NOT EXISTS`. Cannot reject or alter any existing row.

**(c) — additive in effect, but worth being precise about the mechanism** (see §3): it removes the old constraint object and adds a new one. The new constraint is a strict superset of the old allowed values (7 old values + 2 new ones, none removed, none renamed) — so no row that was valid before this migration can become invalid after it. In that sense it's additive to what's *allowed*. But the *operation* itself is not a pure `ADD` — it's documented precisely in §3 because "additive" and "no DROP anywhere in the file" are two different claims, and only the first one is true here.

---

## 3. DROP / ALTER / UPDATE / destructive operations

**One real one, and it's worth flagging precisely rather than waving through:**

```sql
ALTER TABLE ai_interaction_log DROP CONSTRAINT ai_interaction_log_interaction_type_check;
-- immediately followed by, same DO block, same implicit transaction:
ALTER TABLE ai_interaction_log ADD CONSTRAINT ai_interaction_log_interaction_type_check CHECK (...9 values...);
```

This **is** a `DROP` (of a constraint object, not of data or a table) — the migration's own file header calls itself "additive," which is true for what it allows going forward, but the mechanism is drop-and-recreate, guarded by `IF EXISTS` and wrapped in one atomic `DO` block so it can't be left half-applied (either both statements succeed, or neither does — a single `DO` block is one statement, one implicit transaction).

**No `UPDATE`, no `DELETE`, no `DROP TABLE`, no `DROP COLUMN`, no data read or written anywhere in the forward migration.** The four `ALTER TABLE ... ADD COLUMN` statements and two `CREATE INDEX IF NOT EXISTS` statements carry zero destructive risk on their own.

**The real destructive risk in this feature lives in the ROLLBACK file, not the forward migration** — flagged in full in §8, since that's what "destructive operations" should really warn about here: rolling forward is safe; rolling back has a real, data-dependent failure mode.

---

## 4. Safe to run on live production?

**Yes**, with two things confirmed first (not blockers on the migration's own safety, but genuine prerequisites — see §6):

- The four `ADD COLUMN` statements are metadata-only operations in Postgres (11+, and Supabase runs a current version) when the new column is nullable with either no default or a constant default (`'{}'`, `'[]'`) — which is exactly this migration's shape. No table rewrite, no long lock, regardless of how many rows `packages`/`proposals` currently have.
- The constraint replacement on `ai_interaction_log` takes a brief `ACCESS EXCLUSIVE` lock while Postgres validates every existing row against the new CHECK — standard behavior for `ADD CONSTRAINT` without `NOT VALID`. This is the only step with any real lock/duration profile, and it scales with `ai_interaction_log`'s current row count, not with `packages`/`proposals`.

Nothing here reads or writes application data, nothing takes an exclusive lock for longer than a validation scan, and everything is scoped to three tables this migration doesn't create (so no ordering risk with tables created elsewhere in the same batch). **Safe to run**, including on a live database taking real traffic, once §6's prerequisites are confirmed.

---

## 5. Estimated execution time

- Four `ADD COLUMN` statements + two `CREATE INDEX IF NOT EXISTS` statements: **sub-second**, metadata-only (see §4) — true regardless of table size for the column adds; the two indexes are on a `TEXT` column that will be mostly `NULL` at first (both `hall` columns are brand-new), so index build is fast even as a factor of table size.
- The `ai_interaction_log` constraint swap: depends on that table's current row count, which this review has no live-query access to confirm precisely. Reasoned estimate: `ai_interaction_log` only exists live as of migration 012 — itself just confirmed applied this session, meaning this is a young table in production terms. Combined with the fact that writes for the two *new* interaction types have been silently failing (the entire reason this migration exists), overall row volume today is almost certainly low (dozens to low hundreds, not millions). A `CHECK` constraint validation scan at that scale is **well under a second**.

**Overall: this migration should complete in low single-digit seconds, likely under one second**, assuming `ai_interaction_log`'s row count is in the range this reasoning assumes. If a live row count is available before running this, that would convert this from a reasoned estimate to a confirmed one — not something this review can do without database access.

---

## 6. Prerequisites

- **`packages` table exists** — migration 007, part of the "001–011 presumed live" baseline. Not independently re-verified this session, but no contrary evidence exists (unlike migration 004).
- **`proposals` table exists** — migration 003, same baseline, same confidence level.
- **`ai_interaction_log` table exists** — migration 012. **Confirmed live** by this session's verification script.
- **Migration 023 (`023_event_package_management.sql`) — status not confirmed by this session's live check.** This session's verification script tested exactly five migrations (012, 013, 016, 017, 024), per your instruction; 023 wasn't one of them. Worth being precise about *why* this matters: 024's own `ALTER TABLE` statements don't reference any column 023 adds (`event_types`, `images`, `room_inventory_item_ids`, `meal_plan_id`, `tax_rate_override_pct`) — there is **no hard DDL dependency** forcing 023 before 024. `PRODUCTION_MIGRATION_CHECKLIST.md` lists 023 as a dependency in the *feature-completeness* sense (023 and 024 together form the full package-management model this phase intended), not because 024 will fail without it. **Recommendation: confirm 023's live status alongside 024's, using the same verification-script pattern already built this session, before considering the package-management feature area fully deployed — but 024 can be applied independently of 023's status without technical risk.**

---

## 7. Post-deployment verification checklist

1. Re-run `scripts/verify-migrations-012-013-016-017-024.sql` (or just its 024 rows) — confirm all of `packages.hall`, `packages.seating_style`, `packages.addon_service_ids`, `packages.seasonal_pricing`, `packages.standard_discount_pct`, `proposals.hall`, `idx_packages_hall`, `idx_proposals_hall`, and both new `ai_interaction_log_interaction_type_check` values now report PASS.
2. Functional check, per `PRODUCTION_MIGRATION_CHECKLIST.md`'s own spot-check for this migration: trigger the AI Event Sales Advisor from a customer detail page, then run
   ```sql
   SELECT * FROM ai_interaction_log
   WHERE interaction_type = 'event_sales_advisor'
   ORDER BY created_at DESC LIMIT 1;
   ```
   — should return the new row, not be empty. Before this migration, that write silently failed every time.
3. Same check for `'upsell_recommendations'` if that AI action is exercised (`operator-assistant.ts`'s `logInteraction` / the `upsell_recommendations` action in `validation.ts`'s operator-assist schema).
4. Confirm `packages.addon_service_ids`/`seasonal_pricing`/`standard_discount_pct` are readable via the Supabase Table Editor or a plain `SELECT` — these back the Smart Proposal Generator's package safe-fill logic (`package-service.ts`).
5. If the Event Revenue Dashboard's "group by Hall" view is in scope for this release, confirm it renders without error once at least one package/proposal has a non-null `hall` value.
6. Confirm no application error rate increase in Vercel Function Logs for routes touching `packages`, `proposals`, or `ai_interaction_log` in the minutes after this migration runs — this migration doesn't change any existing column's type or nullability, so a spike here would indicate something this review didn't anticipate, not an expected side effect.

---

## 8. Rollback plan

`024_event_sales_expansion_ROLLBACK.sql` exists and was read in full for this review. It does three things, in this order: restores the original 7-value `ai_interaction_log_interaction_type_check` constraint (drop-then-recreate, same pattern as the forward migration), drops `idx_proposals_hall` and `proposals.hall`, then drops `idx_packages_hall` and all five new `packages` columns.

**Two things to know before running it, not obvious from the file alone:**

- **`DROP COLUMN` permanently deletes whatever data is in those columns.** Standard for this project's rollback convention (additive-reversal, not data-preserving — documented project-wide), but worth restating for these specific columns: any `packages.hall`/`seating_style`/`addon_service_ids`/`seasonal_pricing`/`standard_discount_pct` or `proposals.hall` value entered after this migration went live is gone, unrecoverably, the moment the rollback runs. If real packages/proposals have been edited with this data by the time a rollback is considered, take a backup of at least those columns first (`SELECT id, hall, seating_style, addon_service_ids, seasonal_pricing, standard_discount_pct FROM packages` before rolling back) if there's any chance of wanting that data later.

- **The constraint-restoration step can fail outright, and that failure risk grows the longer this migration has been live.** The rollback narrows `ai_interaction_log_interaction_type_check` back to 7 values by dropping and recreating it — but `ADD CONSTRAINT` validates every *existing* row. If even one row already has `interaction_type = 'upsell_recommendations'` or `'event_sales_advisor'` (which is the entire point of applying this migration — letting those writes succeed instead of silently failing), the `ADD CONSTRAINT` step in the rollback will throw a `check_violation` and abort. Because it's inside one `DO $$ ... END $$` block, that block's own `DROP CONSTRAINT` rolls back too (the block is atomic) — so you won't end up with *no* constraint — but the script's remaining statements (the `DROP INDEX`/`DROP COLUMN` lines for `proposals.hall` and `packages.*`) are separate statements outside that block, and depending on how the rollback is executed (SQL Editor "Run" vs. `psql` with `ON_ERROR_STOP`), they may still execute even though the constraint half of the rollback failed — leaving you with the columns dropped but the wider (9-value) constraint still in place. **Recommendation: before running this rollback, first run**
  ```sql
  SELECT interaction_type, count(*) FROM ai_interaction_log
  WHERE interaction_type IN ('upsell_recommendations', 'event_sales_advisor')
  GROUP BY interaction_type;
  ```
  **If this returns any rows, do not run the rollback as-is** — either accept that the constraint can't be narrowed back without first deciding what to do with those rows (deleting or reclassifying them is a data decision for you to make, not something to do silently as part of a "rollback"), or roll back only the column-additions and leave the wider constraint in place. If it returns zero rows, the rollback is safe to run exactly as written.

**Application-level rollback (always available, independent of the above):** Vercel Dashboard → Deployments → promote the last known-good deployment. Doesn't touch the database at all — if the only problem is application code, not the schema itself, this is the faster and lower-risk first move, consistent with this project's standing rollback convention (application rollback before database rollback, decided independently).

---

## Summary

Migration 024 is safe to apply to production: every forward change is additive in effect (new nullable columns, new indexes, a strictly-widened CHECK constraint), none of it touches existing data, and expected execution time is well under a few seconds. The one thing worth doing first is confirming migration 023's live status alongside it (not a blocker, but part of the same feature). The one thing worth knowing before ever rolling it back is that the constraint-narrowing half of the rollback becomes unsafe to run blind the moment real `event_sales_advisor`/`upsell_recommendations` rows exist — check for those first, every time, not just the first time.
