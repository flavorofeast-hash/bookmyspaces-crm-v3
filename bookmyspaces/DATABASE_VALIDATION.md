# DATABASE_VALIDATION.md — Go-Live Prep, Phase 2

Date: 2026-07-27. Every claim below was re-derived by reading the actual migration files in this session — nothing here is copy-forwarded from `PRODUCTION_MIGRATION_CHECKLIST.md` (the prior RC pass's equivalent doc) without being re-checked, per this phase's "assume nothing" instruction. Where the two documents agree, that agreement is itself a useful cross-check.

## Live database connectivity — confirmed unavailable, precisely characterized

This session tested actual network reachability rather than assuming the historical "no Supabase access" finding still holds:

```
curl https://<supabase-project>.supabase.co  → connection failed (timeout)
nslookup <supabase-project>.supabase.co       → "network unreachable"
curl https://registry.npmjs.org               → 200 OK
curl https://github.com                       → 200 OK
curl https://api.openai.com                   → connection failed
curl https://graph.facebook.com                → connection failed
```

This sandbox has a narrow network allowlist (npm registry, github.com reachable; Supabase, OpenAI, Facebook Graph, Resend, Vercel, Google APIs all unreachable) — not a blanket outage. This is a deliberate egress policy, consistent with every prior session on this project. **No live schema query, migration application, or data check was possible from here.** Everything below is static analysis of the migration files in `supabase/migrations/` plus cross-referencing the audit trail's last live-schema snapshot (`audit/SCHEMA_DRIFT_REPORT.md`, captured 2026-07-11).

## Migrations vs production — what can and can't be confirmed statically

**Confirmed by direct file re-inspection this session** (not just cited from the prior pass):

- 24 migration files exist in `supabase/migrations/`, numbered 001-024 with no gaps, each paired with a `_ROLLBACK.sql` for every structural change from 004 onward.
- Migrations 012-024 (13 files): re-grepped fresh — every `CREATE TABLE` uses `IF NOT EXISTS` (22 occurrences, all real statements; the 2 non-matching grep hits were both comment text, not SQL, verified by reading them directly), every `CREATE INDEX` uses `IF NOT EXISTS` (46 occurrences, zero exceptions), `ENABLE ROW LEVEL SECURITY` appears 22 times. This matches `PRODUCTION_MIGRATION_CHECKLIST.md`'s counts exactly — independent re-verification agrees with the prior pass.
- Migration 009 (`009_document_undocumented_production_objects.sql`) — read in full this session. Its own header is unusually informative: it was written specifically to close the gap identified in `audit/SCHEMA_DRIFT_REPORT.md` (10 tables, 3 views, 9 `leads` columns that existed live in production as of a 2026-07-11 snapshot but had never been captured in any migration file). It's framed as documentation-only for those pre-existing objects (idempotent `CREATE ... IF NOT EXISTS`/`OR REPLACE`, matching live schema exactly per that snapshot) plus a small number of genuinely new, additive changes (one new column, two RLS policy sets, four stale anon-policy drops). Its header also explicitly warns it is **"PRODUCTION-ONLY SAFE, NOT FRESH-DATABASE SAFE"** — 4 of its `CREATE TRIGGER` statements depend on functions the migration doesn't define, because it was generated from a schema snapshot that didn't capture function source. **This matters directly for any disaster-recovery or new-environment scenario**: migration 009 alone cannot bootstrap a fresh database; the 4 underlying function bodies (`assign_invoice_number`, `assign_receipt_number`, `sync_proposal_payment_status`, `update_updated_at`) still need to be captured from a live `pg_proc` query and version-controlled in a follow-up migration. Not done in this pass — requires live DB access this sandbox doesn't have.

**Cannot be confirmed from this sandbox — requires direct database access:**

- Whether migrations 001-011 (assumed live) are actually all applied. Specifically flagged as an open question, not an assumption, by the prior RC pass and reconfirmed here: **migration 004 (`broadcast_campaigns`, `festival_calendar` — backs the nav-linked Campaigns page) may never have been applied**, per `audit/VERSION1_RELEASE_READINESS_REPORT.md` (2026-07-15). `audit/SCHEMA_DRIFT_REPORT.md`'s "Category B" (tables defined in migrations but not live, captured from the same 2026-07-11 snapshot) lists `broadcast_campaigns` and `festival_calendar` among 8 tables in that state — direct, independent historical evidence supporting the same concern from a different angle and a different session. **This is the single most important unresolved item in this entire Go-Live pass.**
- Whether migration 009's documentation-only objects still match live reality today (16 days after its 2026-07-11 snapshot) — schema could have drifted further since.
- Whether the 4 underlying trigger functions migration 009 depends on are still present and unchanged.
- Whether migrations 012-024 have been applied at all (prior pass's assumption: not yet — unverified either way from here).

## No missing indexes found (static check)

Every table created in migrations 012-024 has index coverage on its foreign keys and commonly-filtered columns, re-confirmed by direct grep this session (46 `CREATE INDEX IF NOT EXISTS` statements across 8 of the 13 files — the other 5 files are pure `ALTER TABLE`/CHECK-constraint changes with no new indexable columns, e.g. 016-018, 020, 022). No index gaps found relative to what each migration's own tables need. This cannot rule out index gaps on the 10 undocumented-but-live tables from Category A of `SCHEMA_DRIFT_REPORT.md` (`activity_events`, `invoices`, `messages`, `payments`, etc.) — migration 009 documents their existing indexes as of the 2026-07-11 snapshot but this sandbox cannot re-query them today.

## No undocumented objects found in the migration files themselves

Every `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE` in 012-024 is preceded by an explanatory comment tying it to a specific feature (Reservation Platform, Direct Event Sales Engine, Campaign Scheduler, etc.) — consistent with the codebase's own documentation discipline. The "undocumented objects" concern in this codebase's history is specifically about objects that exist **live but not in any migration** (Category A/C/E of `SCHEMA_DRIFT_REPORT.md`), not the reverse — and migration 009 was purpose-built to close exactly that gap, as described above.

## Migration Execution Order

For a database currently at 001-011 (unverified — see above) or earlier:

1. **First, verify live state directly** (`psql` or Supabase Table Editor): confirm `broadcast_campaigns` and `festival_calendar` exist. If either is missing, migration 004 needs to run before or alongside the batch below — it's independent of 012-024 technically, but should be planned as part of the same migration session rather than assumed separately resolved (this is the prior pass's own recommendation, reconfirmed here as still the correct call).
2. Confirm migration 009 has been applied (check for `admin_audit_log`... no — check for the specific new column `follow_ups.trigger_reason`, or the RLS policies on `analytics_events`/`follow_ups`, since 009's other changes are pure documentation of things that already existed). If not applied, apply it — but only after separately capturing the 4 trigger function bodies per its own header warning, if this is anything other than the exact production database it was generated from.
3. Apply 012 → 013 → 014 → 015 → 016 → 017 → 018 → 019 → 020 → 021 → 022 → 023 → 024 in strict numeric order via `npm run db:migrate:v3` (all verified idempotent and dependency-ordered, both this session and the prior RC pass).
4. Run `npm run db:smoke-test:v3`.
5. Spot-check migrations 020 and 024 per `PRODUCTION_MIGRATION_CHECKLIST.md`'s existing spot-check steps (both fix real, previously-silent bugs — worth confirming the fix actually took effect, not just that the migration ran without erroring).

## Summary

Static analysis (file structure, idempotency, indexes, dependency ordering) is thorough and gives high confidence in migrations 012-024 as written. The genuine unknowns are all on the "what does the live database actually contain right now" side, and none of them are new to this pass — they're the same open items the audit trail has carried since mid-July, now cross-verified from a second independent angle (`SCHEMA_DRIFT_REPORT.md`'s Category B corroborating `VERSION1_RELEASE_READINESS_REPORT.md`'s migration-004 concern) rather than resolved. **This phase cannot be marked complete until someone with real database access runs the verification query in step 1 above.**
