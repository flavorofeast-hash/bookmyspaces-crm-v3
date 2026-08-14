# ROLLBACK_PLAN.md — BookMySpaces CRM V3, Night Shift Bundle

Range: `fe67b76` → `a601d97`. Ordered by how the release was deployed (DEPLOYMENT_PLAN.md); roll back in reverse.

## If a problem surfaces after database migrations were applied

**Migration 027 (indexes) rollback:**
```sql
-- supabase/migrations/027_missing_fk_indexes_ROLLBACK.sql
-- Drops all 18 indexes this migration added. Safe at any time — indexes
-- carry no data, dropping them only removes a query-planner optimization.
```
No data-loss risk. No dependent-object risk (nothing in this range creates a view or function depending on these indexes).

**Migration 026 (leads.source CHECK) rollback:**
```sql
-- supabase/migrations/026_leads_source_add_meta_capture_ROLLBACK.sql
-- Restores the 7-value CHECK. WARNING (also stated in the file itself):
-- this FAILS if any leads row has been inserted with one of the 4 new
-- source values since 026 was applied — check first:
--
--   SELECT source, COUNT(*) FROM leads
--   WHERE source IN ('facebook_lead_ads','instagram_lead_ads','facebook_messenger','instagram_dm')
--   GROUP BY source;
--
-- If rows exist, decide what to do with them (e.g. UPDATE ... SET source='other')
-- before rolling back, or accept leaving 026 in place (safe either way —
-- it's strictly more permissive than the prior state, never less).
```
**Recommendation:** if Meta lead capture has started working and produced real leads with these source values, do not roll this back — leave the migration in place and address the actual bug elsewhere. Rolling back a CHECK constraint that real data now depends on is the riskier move, not the safer one.

## If a problem surfaces after code deploy, before/without touching the database

Standard Vercel/Next.js rollback: redeploy the previous production deployment (the one built from `fe67b76`) via the Vercel dashboard's Deployments tab — no git revert needed for an immediate mitigation. This instantly restores all pre-range behavior for code-only concerns (auth, cron, validation, HTML escaping) with zero data impact, since nothing in this range performs a destructive or non-idempotent write.

**If a git-level revert is preferred instead of a Vercel rollback** (e.g. to keep `main` matching what's actually running):
- Revert the whole range: `git revert --no-commit fe67b76..a601d97` (in reverse commit order) then commit, or simply reset a deploy branch to `fe67b76` and force it through Vercel.
- **Do not revert individual commits out of order** — specifically, if `7640a37`+`ce36270` are both still applied, they must be reverted together (reverting only `ce36270` re-introduces the auth-on-public-routes regression this pair exists to avoid).

## Per-area rollback notes

**Meta adapter (`120e70a`):** Pure code revert is safe — no live traffic depends on the new publish branching yet (nothing auto-invokes `publishPost()` in production per `META_SETUP.md`'s Known Limitation). Reverting just restores the old (broken) endpoint selection; no data implication either way.

**Cron fail-closed (`94d1ca7`):** If this causes cron routes to start 500ing in production (meaning `CRON_SECRET` turned out to be unset when this deployed — see DEPLOYMENT_PLAN.md Step 0), the fastest fix is **not** a rollback — it's setting `CRON_SECRET` in Vercel and letting the next cron tick pick it up, since that's the actual missing piece. A code rollback here trades "cron jobs fail loudly" for "cron jobs silently run without auth" — worse, not better. Only revert this commit if there's a reason `CRON_SECRET` genuinely cannot be set right now.

**API validation additions (`a601d97`, `7640a37`'s receipt escaping, admin role validation):** Pure code revert is safe and low-consequence either direction — these only reject previously-invalid input or add output escaping; nothing about them is stateful.

**Dead file removal (`6d26611`):** Reverting restores two files that are not reachable by Next.js routing regardless (wrong filename convention) — reverting this commit has no functional effect either way; only relevant if someone wants the file content back for reference.

**Docs-only commits (`b7537d1`, `3d5d5a9`, `49e41f5`):** No rollback mechanics needed — reverting or not is purely a documentation-presence decision with zero runtime effect.

## What this range does NOT need a rollback plan for

- No destructive DB writes (no `DROP COLUMN`, `DROP TABLE`, `DELETE`, or data-rewriting `UPDATE` anywhere in this range).
- No breaking schema changes to existing constraints (both migrations are additive/permissive).
- No changes to authentication providers, session handling, or RLS policies.
- No new external service dependency introduced (Meta integration already existed; this range only fixes existing calls).
