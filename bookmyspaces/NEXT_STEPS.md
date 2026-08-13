# NEXT_STEPS.md — Manual actions required (BookMySpaces CRM V3)

Everything below requires access this session does not have: GitHub push, Vercel dashboard/API, or live Supabase DB network access. Ordered by dependency (do them roughly top to bottom).

## 1. Get these commits onto GitHub

This session's `main` is 12 commits ahead of GitHub's `fe67b76` and cannot push (`git push origin main` → 403 "not in this session's authorized repository set" — a session permission, not a code issue). Two ways to get them out:

**Option A — grant push access and let this session push.** If you re-run this session (or a follow-up) with this repo in the authorized set, it can push directly.

**Option B — apply the bundle yourself.** A git bundle containing all 12 commits was generated and sent alongside this document (`bookmyspaces-nightshift-fe67b76-a601d97.bundle`). From your local clone (which already has `fe67b76`):
```
git fetch /path/to/bookmyspaces-nightshift-fe67b76-a601d97.bundle HEAD:nightshift
git checkout main
git merge nightshift   # fast-forward, since it's a direct descendant of fe67b76
git push origin main
```

Commits included (`fe67b76..a601d97`, oldest first):
- `120e70a` fix(social): correct Graph API v23 publish endpoints for Meta adapter
- `b7537d1` docs(deploy): document Vercel 3ff8ca5 pinning root cause with git evidence
- `6d26611` chore: remove dead superseded route file duplicates
- `3d5d5a9` docs(env): document DEFAULT_TAX_RATE_PERCENT, the one undocumented app-specific env var
- `1a710d1` fix(db): add missing leads_source_check values for Meta lead capture
- `522add0` test(social): add coverage for Meta lead-capture and DM-capture paths
- `49e41f5` docs(meta): add META_SETUP.md, cross-reference migration 026 lead-capture fix
- `0eb4407` perf(db): add missing indexes on foreign-key columns
- `7640a37` fix(api): require auth on proposal pdf/preview routes, escape HTML in receipt route
- `94d1ca7` fix(cron): fail closed when CRON_SECRET is unset, add error logging to all 4 cron routes
- `ce36270` revert(api): keep proposals pdf/preview routes public — correct earlier commit *(reverts most of `7640a37`'s auth change — net effect: only the receipt-route escaping survives from that commit)*
- `a601d97` fix(api): reject NaN payment amounts, validate role on admin/users routes

## 2. Fix the Vercel deployment pinning

Root cause fully diagnosed in `ROOT_CAUSE.md` (evidence: `3ff8ca5` is a parentless root commit — history was rewritten/force-pushed at some point, desyncing the GitHub↔Vercel webhook binding). Follow `ROOT_CAUSE.md`'s decision tree based on what the Vercel Deployments tab shows for `fe67b76`. This is a dashboard-only fix — no further code change will resolve it.

## 3. Set required Vercel environment variables

| Variable | Why it's now required |
|---|---|
| `CRON_SECRET` | **Behavior changed this pass** — the 4 cron routes now fail closed (500) instead of running unauthenticated when this is unset. Was already a documented must-set item; now enforced in code too. |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_ID` | Meta integration is credential-gated (fails safe/closed without them) but won't function until set. Full walkthrough in `META_SETUP.md`. |
| `WHATSAPP_APP_SECRET` | Pre-existing gap (not from this pass): webhook signature check fails **open** (accepts unsigned requests with a warning) if unset — see `SECURITY_REVIEW.md` finding #2. |

## 4. Apply pending database migrations to production

Neither has touched any live database — this sandbox has no DB network access.

```sql
-- Run in order, via Supabase SQL Editor or CLI:
-- supabase/migrations/026_leads_source_add_meta_capture.sql
-- supabase/migrations/027_missing_fk_indexes.sql
```
Each file has its own pre-flight/post-flight verification queries in its header comments — run those to confirm before/after. Rollback files exist for both (`026_..._ROLLBACK.sql`, `027_..._ROLLBACK.sql`) if needed.

**Until 026 is applied, every Meta Lead Ads / Messenger / Instagram DM capture will keep silently failing** (parses fine, then fails a DB CHECK constraint on insert, webhook still returns 200). This was found and fixed this pass but the fix is only live in the migration file, not the database.

## 5. Redeploy and verify

- Confirm `/api/health` returns 200.
- Confirm a proposal PDF/preview loads (anonymous, no login) — this was almost broken this pass, worth a direct check: open a proposal's share link and click "Download PDF."
- Run through `META_SETUP.md`'s Testing Checklist (Section C) end-to-end once the Meta env vars and console setup are done.

## 6. Decide on documented (not auto-fixed) database drift

None of these block production — the live app already works with the current live schema. They're documentation/consistency gaps, not bugs:

- `leads.lead_stage` and a `notifications` table exist and are used live but are created by no migration file. A backfill migration should be written once someone can pull the exact live `CREATE TABLE`/`ALTER TABLE` DDL for these — this session couldn't query the live DB to generate it accurately, so it wasn't guessed.
- `activity_logs` and `knowledge_chunks`: migrations enable RLS on both, but the live database reportedly has RLS off on both (per `audit/LIVE_SCHEMA_AUDIT.md`). Could be an intentional manual change (e.g. to fix an incident) or drift — needs a person who knows the history to decide, not a blind re-enable that could break something that was disabled on purpose.

## 7. Lower-priority API findings, not yet acted on

Surfaced by this pass's API audit but not fixed, specifically because one finding from the same audit pass (requiring auth on the pdf/preview routes) turned out to be wrong once cross-checked against `SECURITY_REVIEW.md` — so the rest deserve the same cross-check before anyone touches them:
- Mass-assignment risk on `proposals`/`campaigns` PATCH routes (no field allowlist on the update payload).
- Missing rate limiting on 2 public-facing routes.
- Inconsistent error response shapes/HTTP status codes across a handful of routes.
- `leads/import/route.ts` checks auth manually instead of via the shared `requireAuth()` helper — functionally equivalent, just a style inconsistency (noted in `SECURITY_REVIEW.md` already).
- Missing UUID-format pre-validation in 2 routes (a malformed ID currently reaches the DB query and comes back as a normal not-found, not a crash — low severity).
- `ai-summary/route.ts` is a harmless dead stub (confirmed in `SECURITY_REVIEW.md` finding #8) — candidate for deletion in a future cleanup pass, not urgent.
