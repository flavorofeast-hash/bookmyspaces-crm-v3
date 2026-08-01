# Release Candidate 1 — Deployment Readiness

Written: 2026-07-29, after Sprint 1 (Availability & Escalation) was committed and pushed to `release/v1.0.0-rc2` (396 tests, `tsc`, ESLint all passing). This document is the deployment-readiness package for that branch — migrations, deploy sequence, env vars, post-deploy verification, rollback, and remaining blockers. No new features here; this is a verification and consolidation pass over what already exists (`DEPLOYMENT.md`, `PRODUCTION_MIGRATION_CHECKLIST.md`, `docs/DEPLOYMENT_RUNBOOK.md`, `ENVIRONMENT_VARIABLES.md`, `RELEASE_BLOCKERS.md`, `SECURITY_BACKLOG.md`), corrected against what this pass actually found by reading the scripts and migration files directly, not just the docs describing them.

This sandbox has no network route to the production Supabase project or Vercel (reconfirmed this session, consistent with every prior session referenced in `audit/`). Nothing below claiming a live/production state was independently re-verified against the live database — it's evidence-graded (confirmed / presumed / unverifiable) and says so.

---

## 1. Database migrations — what must be applied

| Range | Status | Evidence |
|---|---|---|
| `001`–`003`, `005`–`011` | **Presumed live** | `DEPLOYMENT.md` / `PRODUCTION_MIGRATION_CHECKLIST.md`: "predate this tooling, assumed already live." Not independently re-verified against production in this or the most recent prior audit (`GO_LIVE_STATUS.md`, 2026-07-27, explicitly marks "001-011 vs 012-024 state confirmed" as **NOT VERIFIED**). |
| `004` (`broadcast_campaigns`, `festival_calendar`) | **CRITICAL — unresolved** | `RELEASE_BLOCKERS.md`: three independent pieces of evidence suggest it may never have been applied. If missing, `/campaigns` 500s outright (does not degrade gracefully, unlike the reservation tables). Has its own `_ROLLBACK.sql`. **Must be confirmed one way or the other before this release, not assumed.** |
| `012`–`013` (Reservation Platform — `reservations`, `inventory_items`, etc., 16 tables) | **Confirmed NOT applied** | Re-verified this session and every session back through Sprint 3 (`MIGRATION_012_013_DEPLOYMENT_VALIDATION.md` and five prior sprint/RC reports, all consistent). This is what Sprint 1's manual-block feature and the availability-escalation feature both depend on. |
| `014`–`024` | **Presumed live incrementally, unverified** | `PRODUCTION_MIGRATION_CHECKLIST.md` groups these with 012-013 as "pending / not yet applied" — but see the script gap below, which contradicts that document's own instructions. Treat as **unverified**, not "pending like 012/013" and not "live like 001-011" until checked directly. |
| `025` (`orchestration_decisions` table — Phase 1B observability) | **Unverified, no apply tooling at all** | Newest migration; postdates `PRODUCTION_MIGRATION_CHECKLIST.md`. Not required for this release — the orchestration pipeline it supports (`settings.orchestration.enabled`) defaults to `false` and nothing in Sprint 1 turned it on. Relevant only if/when that flag is ever enabled. |

### A real gap found this pass: the migration script doesn't match the docs

`PRODUCTION_MIGRATION_CHECKLIST.md` step 3 says: *"Use `npm run db:migrate:v3` ... rather than pasting SQL by hand"* for the full 012–024 batch. **That's not what the script does.** `scripts/apply-v3-migrations.mjs`'s `FORWARD_FILES` array contains exactly two files:

```
012_v3_foundation_schema.sql
013_proposal_reservation_links.sql
```

`npm run db:migrate:v3` will **not** apply 014 through 024. Same for the rollback direction and for `db:smoke-test:v3` (its own `RLS_TABLES` comment says "every migration-012 table" — 013's added columns and 014-024 aren't covered either). This is a real, previously-undocumented discrepancy, not a restatement of a known blocker — added to §6 below.

**Recommended resolution before running anything:** either (a) extend `apply-v3-migrations.mjs`'s `FORWARD_FILES`/`ROLLBACK_FILES` arrays to include 014–024 in the documented dependency order (`PRODUCTION_MIGRATION_CHECKLIST.md`'s table already has this order: 014, 015, 016→017, 018, 019, 020→021→022, 023, 024), or (b) apply 014–024 by hand via the Supabase SQL Editor, in that exact order, and accept that `db:smoke-test:v3` won't verify them — only 012/013. Given "no new features" is in scope for this pass, I have not modified the script; this is a decision + follow-up action for whoever executes the deploy, not something silently fixed here.

### One-shot live verification query (resolves all the "presumed"/"unverified" rows above)

Run this in the Supabase SQL Editor before deciding anything else — it turns every row above from a guess into a fact in one query:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in (
  'broadcast_campaigns', 'festival_calendar',           -- 004
  'reservations', 'inventory_items',                     -- 012
  'social_accounts', 'reviews',                           -- 014
  'admin_audit_log',                                      -- 015
  'stage_transitions',                                    -- 019
  'orchestration_decisions'                                -- 025
)
order by table_name;
```

Whatever's missing from the result is whatever's actually pending — apply exactly those migrations, in numeric order, not the whole range blind.

---

## 2. Ordered deployment checklist

1. **Backup.** Confirm Supabase automatic backups are current, or take a manual one. (`PRODUCTION_MIGRATION_CHECKLIST.md` §Pre-migration checklist.)
2. **Run the one-shot verification query above** against production. Note exactly which tables are missing.
3. **Apply missing migrations, in numeric order**, from a machine with real Supabase network access (not this sandbox):
   - `012`/`013` (if missing): `DATABASE_URL="..." npm run db:migrate:v3`, then `npm run db:smoke-test:v3`.
   - `004` (if missing): `psql -f supabase/migrations/004_phase4_campaigns.sql` (or SQL Editor).
   - `014`–`024` (if missing): SQL Editor, in the order in `PRODUCTION_MIGRATION_CHECKLIST.md`'s table, until the script gap in §1 is resolved.
4. **Set every environment variable** in Vercel Project Settings — full list in §3. Do this before the deploy that needs them, not after.
5. **Confirm `tsc --noEmit`, `eslint`, `vitest run` are clean** on `release/v1.0.0-rc2` — already done per your message (396 tests, `tsc`, ESLint all passing). Re-confirm `npm run build` completes — this is explicitly the one check `docs/DEPLOYMENT_RUNBOOK.md` flags as never having been verified from any engineering sandbox session across this project's history; it needs a real pass on a real machine or CI runner, not assumed clean because the smaller checks are.
6. **Push/merge `release/v1.0.0-rc2`** to the branch Vercel deploys from (or connect Vercel directly to this branch for the RC deploy).
7. **Watch the Vercel build log to completion.** Don't assume success from the deploy triggering.
8. **Configure external webhooks** (WhatsApp Meta App dashboard, Social if in scope) to point at the new production URL — `DEPLOYMENT.md` §5.
9. **Confirm `vercel.json`'s 4 cron routes** are scheduled (automatic once this repo's `vercel.json` deploys as-is: `followups` 9am, `escalations` 6pm, `campaign-queue` hourly, `stay-lifecycle` 8am, all `bom1`/IST-relative). Nothing manual here beyond `CRON_SECRET` in §3.
10. **Run post-deployment verification** — §4 below.
11. **Monitor Vercel Function Logs** for the first stretch after go-live (no APM/error-tracking service is wired in yet — this is the primary signal today, per `DEPLOYMENT.md`).

---

## 3. Required environment variables

Full annotated reference: `ENVIRONMENT_VARIABLES.md` (source of truth for names is `.env.example`). Summarized and cross-checked against the last known production snapshot (`GO_LIVE_STATUS.md`, 2026-07-27) below — **PASS** means confirmed present in that snapshot, **FAIL** means confirmed absent, **unverified** means no production snapshot evidence either way.

**Required for the app to start:**
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` — all local-confirmed present; production presence unverified from this sandbox, must be confirmed in Vercel directly.

**AI grounding:** `OPENAI_API_KEY` — same as above.

**WhatsApp (Meta Cloud API — the live channel):** `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — unverified in production. `WHATSAPP_APP_SECRET` — **FAIL, confirmed absent**. Security-critical: webhook signature verification is skipped (not enforced) without it. **Must be set before this release goes live.**

**Cron authentication:** `CRON_SECRET` — **FAIL, confirmed absent**. All 4 cron routes run with zero authentication without it. **Must be set before this release goes live**, and the same value must be configured wherever Vercel Cron auth is set (or the routes' own bearer-token check, per `docs/DEPLOYMENT_RUNBOOK.md`).

**Outbound email (Resend):** `RESEND_API_KEY`, `EMAIL_FROM` — **FAIL, both confirmed absent.** Degrades gracefully (proposal email falls back to `mailto:`, other routes return a clear "not configured" message) — not a launch blocker, but no automated email sends until set.

**Social (Meta Graph API — optional):** `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_ID` — module is credential-gated and fails closed if unset; safe to deploy without these, Facebook/Instagram capture just stays inactive.

**Google Sheets sync (optional):** `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_ID` — all three flagged "placeholder-looking" in local env during an earlier audit pass; production status unverified. Not a launch blocker.

**App config:** `NEXT_PUBLIC_APP_URL` — **must be set to the real production domain**, unverified in the last snapshot whether it was. `NEXT_PUBLIC_BUSINESS_WHATSAPP` — confirmed correct in production (`9051459463`, matches every customer-facing doc).

**Explicitly do not set:** `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NEXTAUTH_SECRET`, `WATI_VERIFY_TOKEN`, `WATI_WEBHOOK_SECRET`, `NEXT_PUBLIC_BUSINESS_PHONE` — unused, per `ENVIRONMENT_VARIABLES.md`.

**Nothing in Sprint 1 added a new environment variable.**

---

## 4. Post-deployment verification checklist

Baseline (from `DEPLOYMENT.md` §7 / `docs/DEPLOYMENT_RUNBOOK.md`'s Health Checks):

1. `GET /api/health` returns 200, and reports Supabase/Anthropic/OpenAI all healthy.
2. `/customers` loads with real data — fastest true "talking to the right database" signal, doesn't depend on migration 012.
3. `/reservations` loads without an error banner. All-zero stats is expected and correct if 012/013 aren't applied yet in this deploy — not a failure.
4. `/campaigns` loads without a 500 — only meaningful once migration 004's status is resolved (§1).
5. Log into the CRM and confirm the account/sidebar renders correctly.
6. Send a real WhatsApp message to the connected number, confirm it lands in the Inbox and gets an AI reply.
7. Create a test lead via the website chat widget, confirm it appears on the Kanban board.
8. Open a proposal share link in an incognito window (no login) — the one fully public page.
9. Re-run `npm run db:smoke-test:v3` against production if 012/013 were applied this deploy.

**Sprint 1-specific additions** (full detail in `audit/SPRINT1_E2E_TEST_PLAN.md`, written this session):

10. `POST /api/reservations/block` with a real property/inventory item + a reason: returns 201, `guestName` starts with `BLOCKED —`, and a subsequent overlapping availability check for the same item correctly reports unavailable with the block's reservation id as the conflict.
11. `POST /api/reservations/block` with an empty `reason`: returns 400 (schema validation).
12. If `settings.orchestration.enabled` is ever turned on for this release: confirm a normal (non-error) availability check still behaves as before, and that Sprint 1's `availabilityUnknown` path can't be exercised except via a genuine DB-query failure — not something to force-test in production, covered instead by the automated integration test (§ below).
13. Confirm the automated test suite this session added is part of whatever CI/build gate runs before this deploy: `availability-service.test.ts`, `orchestration-executor.test.ts`, `orchestrator.test.ts`, `reservation-workflow.test.ts`, `validation.test.ts`, and `availability-escalation.integration.test.ts` (the last one's clean run was still pending as of this session — see §6).

---

## 5. Rollback procedure

**Application (always the first lever):** Vercel Dashboard → Deployments → select the last known-good deployment → **Promote to Production**. Instant, no data risk, doesn't touch the database. Do this before investigating root cause if something is badly wrong post-deploy.

**Database — independent decision, don't reflexively roll back both:**

- Migrations 012/013: `DATABASE_URL="..." npm run db:rollback:v3` — runs `013_..._ROLLBACK.sql` then `012_..._ROLLBACK.sql`, in that order. **Destroys any real reservation/property/inventory data created after the migration** — read the rollback scripts' own warnings, take a fresh backup first if any real bookings exist.
- Migration 004: `psql -f supabase/migrations/004_phase4_campaigns_ROLLBACK.sql`.
- Migrations 014–024 (if applied per §1's manual path): each has a matching `_ROLLBACK.sql` alongside it; run in **reverse** numeric order (024 → 014), respecting the dependency chain in `PRODUCTION_MIGRATION_CHECKLIST.md` (e.g. 022 before 021 before 020, since 022 depends on 021's columns).
- Every rollback here is additive-reversal only — none of these migrations delete or transform pre-existing data, so rollbacks don't attempt to restore anything, only remove what the migration itself added.

**Cron/webhooks:** no redeploy needed to disable a specific integration — rotate or remove the relevant credential (e.g. `WHATSAPP_APP_SECRET`) and the webhook starts rejecting requests immediately.

**Sprint 1 specifically:** every change this sprint made is additive (new `status` field alongside the unchanged `available` boolean, a new `HandoffReason` union member, a new `availabilityUnknown` result field, a new API route). Rolling back the application deployment alone fully reverts Sprint 1's behavior with no database rollback required — none of it altered schema.

---

## 6. Remaining production blockers

**CRITICAL — must resolve before this release goes live:**

- Migration 004's live status is unconfirmed, with active evidence it may be missing (`/campaigns` 500s outright if so). Resolve via §1's one-shot query.
- `WHATSAPP_APP_SECRET` unset in production — webhook signature verification not enforced.
- `CRON_SECRET` unset in production — all 4 cron routes unauthenticated.
- Migrations 012/013 confirmed not applied — blocks Sprint 1's manual-block feature and any availability-checking flow end to end.
- **New this pass:** `npm run db:migrate:v3` only covers migrations 012–013, not the 012–024 range `PRODUCTION_MIGRATION_CHECKLIST.md` instructs it to cover. Decide and execute one of the two resolutions in §1 before relying on that script for anything beyond 012/013.

**HIGH:**

- `npm run build` has never been confirmed to complete successfully outside an AI-sandbox environment, across this project's entire history. Must happen once, for real, before trusting this deploy.
- `RESEND_API_KEY` / `EMAIL_FROM` unset in production — no automated email sends (degrades gracefully, not a hard failure).
- No `.git` directory in the sandbox-mounted working copy used for all engineering sessions on this project, including Sprint 1 (tracked in `SECURITY_BACKLOG.md`) — orthogonal to the branch you just pushed from your own machine, but worth resolving so future sandbox sessions aren't working from an un-versioned copy.
- `availability-escalation.integration.test.ts` (this session's integration-test addition) has not yet completed a clean run — the sandbox degraded mid-session (even previously-passing files began timing out) before a pass could be captured. Re-run it as part of whatever CI gate runs before this deploy; it's new test-only code, not a behavior change, but it hasn't been proven green yet.

**MEDIUM:**

- `docs/DEPLOYMENT_RUNBOOK.md` cites `PRODUCTION_DEPLOYMENT_GUIDE.md` and `DISASTER_RECOVERY_PLAN.md` — neither exists in this repository. `DEPLOYMENT.md` and `PRODUCTION_MIGRATION_CHECKLIST.md` cover most of the same ground; either write the missing files or repoint the references.
- Migration 025 (`orchestration_decisions`) has no apply script at all (only a smoke test). Not required for this release (orchestration stays default-off), but will need one before that feature is ever turned on.

**Explicitly not blockers for this release:** Social/Google Sheets credentials (both fail closed/degrade gracefully when unset), migration 025 (unless orchestration is being turned on), the git-metadata gap (doesn't block Vercel/Supabase deployment itself).
