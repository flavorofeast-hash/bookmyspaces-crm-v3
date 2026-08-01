# Migration 023 — Deployment Readiness Review

Written 2026-07-29, RC1 mode, following the same format as `audit/MIGRATION_024_DEPLOYMENT_REVIEW.md`. Review only — `supabase/migrations/023_event_package_management.sql` and its paired `023_event_package_management_ROLLBACK.sql` were read in full for this; neither file, nor any other code or migration, was modified.

---

## 1. Schema/data changes

Two `ALTER TABLE` statements, both against tables that already exist live (`packages` since migration 007, `proposals` since migration 003), plus two indexes. No `UPDATE`, no `DELETE`, no data read or written anywhere in the file.

**On `packages` — five new nullable columns:**
- `event_types TEXT[] DEFAULT '{}'` — which of the business's event types this package applies to; empty/NULL means "applies to all."
- `images TEXT[] DEFAULT '{}'` — for Content Studio / proposal display use.
- `room_inventory_item_ids UUID[] DEFAULT '{}'` — references `inventory_items(id)` (migration 012), not DB-enforced (array column, same convention used throughout this project for array-of-FK columns), which rooms a package includes.
- `meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL` — a real, DB-enforced foreign key into `meal_plans` (migration 012). This is the one genuinely new *relationship* 023 introduces, not just a new column — see §5's verification script, which checks this FK specifically, not just the column's existence.
- `tax_rate_override_pct NUMERIC(5,2)` — optional per-package override of `src/lib/tax.ts`'s default tax rate.

Plus `idx_packages_event_types`, a **GIN** index (not a plain B-tree) on `event_types` — the correct index type for array-containment queries (`event_types @> ARRAY[...]`), and worth confirming as GIN specifically, not just "an index with this name," since a B-tree index on an array column wouldn't actually serve the query pattern this column exists for.

**On `proposals` — one new nullable column:** `package_id UUID REFERENCES packages(id) ON DELETE SET NULL`, plus `idx_proposals_package_id`. **Important cross-reference: migration 013 (already confirmed live) adds this exact same column and constraint shape to `proposals` independently.** `PRODUCTION_MIGRATION_CHECKLIST.md` already flags this: 023's `ADD COLUMN IF NOT EXISTS package_id` on `proposals` is redundant-but-harmless if 013 already ran — it will simply no-op. This matters directly for §3 below.

---

## 2. Additive or destructive?

**Fully additive, forward direction.** Every `ADD COLUMN` uses `IF NOT EXISTS`, every new column is nullable with either an empty-array default or no default, both `CREATE INDEX` statements use `IF NOT EXISTS`. No existing column is altered, renamed, or dropped; no existing row can be rejected or changed. Unlike migration 024, there's no constraint drop-and-recreate here at all — nothing in this file removes any existing database object, even transiently. This is the more straightforwardly additive of the two migrations reviewed so far.

**The rollback (`023_event_package_management_ROLLBACK.sql`) is destructive in the same way every rollback in this project is** — it does `DROP COLUMN IF EXISTS` for all six new columns (five on `packages`, one on `proposals`) and drops both indexes. Any data entered into those columns after this migration goes live is permanently lost if the rollback is ever run. Unlike migration 024's rollback, there's **no constraint-validation failure mode** here — `DROP COLUMN`/`DROP INDEX ... IF EXISTS` can't fail due to existing data the way `ADD CONSTRAINT` can, so this rollback is safe to run at any time from a "will it error" standpoint. It's still a one-way data loss for whatever was stored in those six columns, which is the thing to actually weigh before running it, not whether it will succeed mechanically.

---

## 3. Is it already reflected in production?

**Cannot be confirmed from this sandbox** (no live database access, same constraint as every prior review this session) — but there's a genuine complication worth stating plainly rather than glossing over: **`proposals.package_id` and `idx_proposals_package_id` are not reliable signals for 023's status on their own**, because migration 013 — already confirmed live by your verification — adds the identical column and index. If you were to check only those two objects and find them present, that would be consistent with either "023 has run" or "013 ran and 023 hasn't" — it can't distinguish the two.

The reliable signal is the five `packages.*` columns and the `idx_packages_event_types` GIN index — nothing else in this codebase touches those. §5's script is built around that distinction: it scores PASS/FAIL for migration 023 based only on the unambiguous `packages` objects, and reports the `proposals.package_id` pair separately, labelled as ambiguous, for your own cross-reference rather than folding it into the pass/fail verdict.

---

## 4. Required before or after 024?

**No hard ordering requirement between them.** Re-confirmed by re-reading both files: migration 024's `ALTER TABLE packages ADD COLUMN ...` statements (`hall`, `seating_style`, `addon_service_ids`, `seasonal_pricing`, `standard_discount_pct`) don't reference `event_types`, `images`, `room_inventory_item_ids`, `meal_plan_id`, or `tax_rate_override_pct` anywhere — no foreign key, no computed column, no constraint that depends on 023's columns existing first. Either migration can be applied independently of the other's status without a technical failure.

`PRODUCTION_MIGRATION_CHECKLIST.md` lists 024 as depending on "023 (packages fields)" — this is accurate as a *feature-completeness* statement (023 and 024 together form the complete package-management data model this project phase intended) but not as a *migration-ordering* requirement. Given that, the recommendation is: **apply in numeric order (023 before 024) because that's the established convention and there's no reason to deviate from it**, not because applying 024 first would break anything. If 024 has already been applied and 023 hasn't (023's status being genuinely unknown right now), there's no cleanup or special handling needed before applying 023 afterward — it's still a plain additive `ALTER TABLE`, unaffected by whatever order 024 landed in.

---

## 5. Read-only verification SQL

`scripts/verify-migration-023.sql` — written this pass, validated by parsing it through the actual Postgres grammar (`pgsql-parser`, built on `libpg_query`) since this sandbox has no live database to execute it against; it parses cleanly. Same guarantees as the migration-024-era verification script: every statement is a `SELECT` against `information_schema`/`pg_catalog` only, no DDL, no DML, no application data (`packages`/`proposals` rows) is ever read.

It checks, specifically:
- All five `packages.*` columns 023 adds.
- That `packages.meal_plan_id` is a real foreign key targeting `meal_plans` (not just a same-named column — checked via `information_schema.table_constraints`/`key_column_usage`/`constraint_column_usage`, not just column existence).
- That `idx_packages_event_types` exists **and** is specifically a GIN index (`indexdef ILIKE '%USING gin%'`), not just any index with that name.
- `proposals.package_id` and `idx_proposals_package_id`, labelled and reported separately as ambiguous with migration 013, per §3 — excluded from the PASS/FAIL verdict itself so a false-positive "023 is live" conclusion can't come from an object 013 could have created instead.

Paste the whole file into the Supabase SQL Editor and run it once. One result set: a `TL;DR` line stating plainly whether migration 023 is fully applied, a summary row with the object count, and full per-object detail underneath.

---

## Summary

Migration 023 is a clean, straightforwardly additive migration with no failure-prone rollback path (unlike 024's constraint-narrowing risk). Its live status is currently unknown and wasn't part of your last verification pass. It has no technical ordering dependency with 024 in either direction — apply both, in numeric order, whenever convenient. The one thing worth being careful about is not mistaking `proposals.package_id`'s presence for proof that 023 ran, since migration 013 could have put it there instead — use the `packages.*` columns as the real signal, which is exactly what §5's script does.
