# Strategy B Implementation Report — Packages Schema Reconciliation

**Date:** 2026-08-02
**Mission:** Implement Strategy B — reconcile the live `packages` table to the application schema (source of truth), via a production-safe migration.
**Mode:** Implementation. No manual database edits performed or instructed. No feature/architecture/UI/database-design changes.

---

## 1. Files changed

| File | Type | Change |
|---|---|---|
| `supabase/migrations/028_reconcile_packages_schema_drift.sql` | New | Forward migration — 3 guarded `RENAME COLUMN` statements + 1 index recreation. |
| `supabase/migrations/028_reconcile_packages_schema_drift_ROLLBACK.sql` | New | Paired rollback — renames the 3 columns back, same guard pattern. |
| `docs/engineering/MASTER_DATABASE.md` | Edited | Migration inventory: added row 028 (file count 25→28). Added a "Strategy B reconciliation" note under the existing drift callout, stating apply status. Cross-linked the two existing drift mentions (rows 007, 023–024) to point at 028. |

No application code (`.ts`/`.tsx`) was changed. `src/lib/packages/package-service.ts` and every caller already read/write `venue`/`base_price`/`max_guests` — per Strategy B, the schema moves to match the code, not the other way round, so no code edit was needed or made.

Commit: `3c893aa` on `release/v1.0.0-rc2` — scoped to exactly the 3 files above (the pre-existing uncommitted change to `src/lib/whatsapp/auto-responder.test.ts` in the working tree predates this mission and was deliberately left out, consistent with this session's file-scoping discipline).

---

## 2. SQL generated

**Forward (`028_reconcile_packages_schema_drift.sql`):**

```sql
DO $$ BEGIN
  IF EXISTS (... column_name = 'property') AND NOT EXISTS (... column_name = 'venue') THEN
    ALTER TABLE packages RENAME COLUMN property TO venue;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (... column_name = 'price') AND NOT EXISTS (... column_name = 'base_price') THEN
    ALTER TABLE packages RENAME COLUMN price TO base_price;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (... column_name = 'capacity_max') AND NOT EXISTS (... column_name = 'max_guests') THEN
    ALTER TABLE packages RENAME COLUMN capacity_max TO max_guests;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_packages_venue ON packages(venue);
```

Each guard makes the rename a no-op in three real situations: a fresh install where 007/023/024 already created the app-schema columns directly, a second run of this same migration, and (the case this migration exists for) the drifted production table.

`RENAME COLUMN` was used instead of add-column-and-backfill for all 3 — the "IMPORTANT" constraints (no duplicate columns, no temp columns, prefer rename) are satisfiable outright here; there was no PostgreSQL limitation forcing another strategy. A rename preserves the column's data, type, default, and any `NOT NULL`/`CHECK` constraint automatically (Postgres tracks columns by internal attribute number, not name), and any index or FK expression referencing the old name is transparently repointed — so "preserves data / constraints / FKs / triggers / defaults" fall out of the rename itself. The one thing a rename does *not* do is create an index that never existed — `idx_packages_venue` (defined on `packages(venue)` in migration 007) could not have existed on the drifted live table, since the `venue` column didn't exist to index, so it's recreated explicitly with `CREATE INDEX IF NOT EXISTS`. `base_price`/`max_guests` were never indexed under either name in any migration, so nothing else needed recreating.

**Rollback (`028_reconcile_packages_schema_drift_ROLLBACK.sql`):** the mirror image — `venue→property`, `base_price→price`, `max_guests→capacity_max`, same guard pattern. Documented but deliberately not auto-handled: `idx_packages_venue` is left in place after rollback (it will simply be indexing `property` again); there's no reliable way for the rollback to know whether 028 created that index or it already existed, and dropping something that might predate 028 would violate the "only undo what the forward migration did" convention this repo's other rollback files follow.

---

## 3. Scope — what this migration does NOT touch

The verification report this mission is scoped to (Requirement 3) confirmed exactly 3 drifted column pairs: `price`/`property`/`capacity_max` present, `base_price`/`venue`/`max_guests` absent. That is exactly what 028 fixes.

Reading `supabase/seed/rc1_catalog_test_seed.sql`'s header (an earlier session's live-schema notes, not independently re-verified by me this session) surfaced a **wider** claim: that the live table also carries `slug`, `type`, `price_note`, `duration`, `capacity_min`, `sort_order` — columns no migration file ever created — and may also be missing `tier`, `duration_hours`, `description`, `ai_description`, which migration 007 does define. None of that broader claim is part of the verification this mission cites, and no application code reads or writes any of those additional names, so I did not fold it into 028 — doing so on unverified evidence would violate "keep the migration as small and reversible as possible." Flagged as a follow-up (Risks, below).

---

## 4. Stale drift assumptions found in the repo (reported, not edited)

Per Requirement 7, searched for code/docs that assume the drift is still present. Two application-code comments describe the drift as a live, current condition and will read as stale once 028 is confirmed applied:

- `src/app/[campaign]/page.tsx` (lines 58–65) — comment above the `listPackages()` call for the 5 campaign landing pages, says this "may legitimately return an empty list until that drift is resolved."
- `src/components/landing/LandingPackages.tsx` (lines 4–6) — comment explaining the empty-state UI exists because of "confirmed schema drift, ENG-003/BUG-003."

Both are accurate *today* (028 is written but not yet applied) and neither blocks anything — `listPackages()` already fails soft (`.catch(() => [])`) and the empty state is handled honestly per those same comments. I left them unedited, consistent with keeping this change scoped to the migration + the doc update Requirement 6 explicitly asked for. Recommend a one-line comment update in both files once 028's apply status in `MASTER_DATABASE.md` is flipped to "Confirmed live."

Also found, informational only (not edited, not blocking):

- `scripts/verify-packages-columns.sql` — the verification script itself; still correct and directly reusable to confirm 028 applied cleanly (see deployment order below).
- `supabase/seed/rc1_catalog_test_seed.sql` — an unrun, review-before-use seed script that `INSERT`s into `packages` by the *drifted* production column names (`property`, `price`, `capacity_max`, plus the wider unverified set above). This script will need its column list rewritten to the app-schema names before anyone runs it, once 028 is applied — flagged here rather than edited, since it was never executed and editing it isn't required to fix the live drift.
- A number of `.md` reports (`GO_LIVE_CHECKLIST.md`, `PRODUCTION_VERIFICATION_REPORT.md`, `RC_FINAL_STABILIZATION_REPORT.md`, several `audit/*.md` files, `docs/business/02_PACKAGES.md`, `docs/growth/04_GAP_ANALYSIS.md`) reference the drift as a known, open issue. These are point-in-time audit records, not live documentation — `MASTER_DATABASE.md` is the one doc this mission's Requirement 6 asked to be kept current, and it now reflects 028's existence.

`src/lib/pricing/pricing-service.ts`'s `checkSystemPromptPricingDrift()` and `src/lib/analytics/revenue-intelligence.ts`'s "possibly-drifting copy" comment also matched a `drift` search but are unrelated — they mean *pricing-value* drift (hardcoded `SYSTEM_PROMPT` numbers vs. live prices) and *code-duplication* drift, not the schema-naming drift this mission is about. Excluded as false positives.

---

## 5. Verification

Run in the sandbox's disposable verification copy (`~/bms`, rsynced from the mounted repo — never the repo itself):

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **Pass** — 0 errors, 0 output lines. |
| `npx vitest run` | **Pass** — 55 test files, **517/517 tests passed**. |
| `npx next build` | **Pass** — exit code 0. All routes compiled and generated, including the 5 static campaign landing pages (`/wedding`, `/birthday`, `/corporate`, `/airport-stay`, `/staycation`) that call `listPackages()` directly. |

One methodology note, disclosed for full transparency: this sandbox tears down any backgrounded process the instant a shell call returns (confirmed empirically — `setsid`/`nohup`/`disown`, and even a separate `tmux` daemon, all died between calls), and a single call is hard-capped at 45s. `next build`'s lint + type-check + static-generation phases together exceeded that cap on this codebase. Since `tsc --noEmit` had already independently confirmed 0 type errors moments earlier, I temporarily set `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true` **only in the disposable `~/bms` copy** (confirmed the real `next.config.js` in the mounted repo was never touched — diffed identical before/after) so the build's compile/bundle/static-generation machinery — the part `tsc` alone doesn't exercise — could be verified end-to-end within one call. This is a sandbox-execution workaround, not a change to the shipped configuration; nothing about it was committed.

No code was changed by this mission, so this verification pass is confirming the *absence* of regressions from a pure-SQL, doc-only change — which is what it shows.

---

## 6. Risks

1. **Apply status.** Per `MASTER_DATABASE.md`'s own governance rule, this migration is not "done" until independently confirmed applied to production — that has not happened. Nothing in this repo, including this report, should be read as claiming the live drift is fixed yet.
2. **Scope gap vs. the seed-script's wider claim.** If the live table really does carry the extra out-of-migration columns (`slug`/`type`/`price_note`/`duration`/`capacity_min`/`sort_order`) or is missing others 007 defines (`tier`/`duration_hours`/`description`/`ai_description`), 028 does not address that — it wasn't part of the verification this mission cites. Recommend running a full `information_schema.columns` inspection for `packages` (not just the 10 named checks in `scripts/verify-packages-columns.sql`) immediately before or after applying 028, to settle whether that broader claim is still current.
3. **Column type/precision unverified.** A rename doesn't require or check that `price`'s underlying type matches `base_price NUMERIC(10,2)` from migration 007 — whatever numeric type the live column already has is preserved as-is. The application casts with `Number(...)` everywhere it reads this column, so a looser numeric type is not expected to break anything, but this wasn't independently confirmed against the live column definition.
4. **RLS/trigger presence, not just preservation.** The migration preserves whatever RLS policies and triggers already exist (renames are role/table-level-neutral), but if the live `packages` table was originally created out-of-band rather than via migration 007, it's possible `packages_anon_read`/`packages_service_role_all`/`update_packages_updated_at` were never actually applied live either. This migration does not create or verify them — that was out of this mission's stated scope (rename 3 columns), and asserting their live presence wasn't part of the cited verification report.
5. **No live execution.** As with every prior database mission this session, I have no network path to the production Supabase project from this sandbox (confirmed, `supabase.co` blocked by the outbound proxy allowlist). This migration has been designed, written, and verified structurally/idempotently, but not run against production by me.

---

## 7. Recommended deployment order

1. Run a full, unscoped `information_schema.columns` check against production `packages` (not just `scripts/verify-packages-columns.sql`'s 10 named checks) to settle Risk #2 above before or immediately after applying 028.
2. Apply `028_reconcile_packages_schema_drift.sql` to production (human-run, via whatever mechanism this project already uses to apply migrations — no click-path is prescribed here per the mission's instruction).
3. Immediately re-run `scripts/verify-packages-columns.sql` — expect the TL;DR to flip from "CONFIRMED: ... drift ..." to "packages table matches application code."
4. Smoke-test one read path end-to-end (e.g. a campaign landing page, or the WhatsApp pricing reply) to confirm `listPackages()`/`getPackageById()` now return real `venue`/`basePrice`/`maxGuests` values instead of the previous `undefined`/`0`/default fallbacks.
5. Update `MASTER_DATABASE.md`'s new "Strategy B reconciliation" line from "NOT YET applied" to "Confirmed live," per the existing apply-status convention.
6. Optional cleanup once step 5 is done: refresh the two now-stale drift comments in `src/app/[campaign]/page.tsx` and `LandingPackages.tsx` (Section 4), and rewrite `supabase/seed/rc1_catalog_test_seed.sql`'s `packages` INSERT to the app-schema column names before anyone runs it.
7. Rollback path, if needed: `028_reconcile_packages_schema_drift_ROLLBACK.sql`, same apply mechanism, reverses cleanly (see Section 2's note on the one intentionally-left-behind index).
