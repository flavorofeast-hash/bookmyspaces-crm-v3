# RELEASE_BLOCKERS.md

Created: 2026-07-28, at the creation of Release Candidate **v1.0.0-rc2**. This document exists to formally separate two different milestones: **RC creation** (a code/documentation checkpoint — this repository is approved for it) and **production deployment** (which requires every CRITICAL and HIGH item below to be resolved first). Creating `v1.0.0-rc2` does not require anything on this list to be done. Promoting past `rc2` to `v1.0.0` does.

Full evidence trail behind every item here: `RELEASE_REPORT_GLP.md`, `GO_LIVE_STATUS.md`, `ENVIRONMENT_VALIDATION.md`, `DATABASE_VALIDATION.md`, `PRODUCTION_BUILD_VALIDATION.md`, and the Final Pre-Flight Review delivered in this session.

## CRITICAL — must be resolved before any production deployment

- [ ] **Verify migration 004 (`broadcast_campaigns`, `festival_calendar`) has actually been applied to the production database.** Three independent pieces of evidence across separate sessions suggest it may never have been — most recently, `docs/DEPLOYMENT_RUNBOOK.md` states plainly that this app "does not tolerate a missing `broadcast_campaigns` table gracefully (Campaigns 500s outright)." If missing, apply it — it has its own `_ROLLBACK.sql`, same safety profile as 012-024. Check: `psql`/Supabase Table Editor, confirm both tables exist.
- [ ] **Configure `WHATSAPP_APP_SECRET` in the production environment.** Confirmed absent from both `.env.local` and an actual `vercel env pull --environment=production` snapshot. Without it, the WhatsApp webhook accepts unsigned/forged requests instead of rejecting them (fails open).
- [ ] **Configure `CRON_SECRET` in the production environment.** Confirmed absent from the same production snapshot. Without it, all 4 cron routes (`campaign-queue`, `escalations`, `followups`, `stay-lifecycle`) execute with zero authentication.

## HIGH — should be resolved before production deployment

- [ ] **Obtain one successful, logged `npm run build` from a real machine or CI runner outside any AI-sandbox environment.** Every attempt across every engineering session on this project (including this one) has hit the same environmental hang (`tsc`/`next build`/`next lint`/`vitest` all stall with near-zero CPU past ~40s). Strong evidence points to a sandbox-specific I/O/scheduling issue, not a code defect — but it has never actually been confirmed to complete successfully anywhere. This is the one item on this list that isn't a configuration checkbox; it needs to actually happen once before trusting the build.
- [ ] **Configure `RESEND_API_KEY` in the production environment.** Confirmed absent from the production snapshot. The app degrades gracefully (proposal email falls back to `mailto:`, other email routes return a clear "not configured" message) — so this doesn't crash anything, but no automated email currently sends in production (invoices, payment reminders, follow-ups, booking confirmations).
- [ ] **Configure `EMAIL_FROM` in the production environment.** Same finding, same fix, goes with the item above.

## MEDIUM — should be resolved before production deployment, lower urgency

- [ ] **Resolve the duplicate deployment documentation.** `DEPLOYMENT.md` (root) and `docs/DEPLOYMENT_RUNBOOK.md` (pre-existing, 2026-07-15) cover overlapping ground without cross-referencing each other — found during the Final Pre-Flight Review. They don't contradict each other on substance, but an un-linked duplicate is exactly the kind of thing that causes someone to follow the stale copy during a real incident. Fix: cross-link the two, or consolidate.
- [ ] **Replace or remove references to missing documentation files.** `docs/DEPLOYMENT_RUNBOOK.md` cites `PRODUCTION_DEPLOYMENT_GUIDE.md` (4 separate section references) and `VERSION1_1_ROADMAP.md` — neither exists anywhere in this repository. Either write them, or repoint the references at documents that actually exist (`DEPLOYMENT.md` already covers most of the same ground).

## LOW — nice to close out, not a real risk either way

- [ ] **Document `DEFAULT_TAX_RATE_PERCENT` in `.env.example` and `ENVIRONMENT_VARIABLES.md`.** Real, working, fully-tested optional config (`src/lib/tax.ts`) that was simply never added to the environment docs. Defaults safely to 0% (today's existing behavior) if unset — a documentation gap, not a functional one.
- [ ] **Delete the two accidental 0-byte files, `git` and `npm`, from the project root.** Confirmed accidental (verified by the user via PowerShell). Already `.gitignore`d so they can never be committed; still physically present on disk.
- [ ] **Decide whether `package.json`'s `"version"` field should reflect the RC status** (currently `"1.0.0"`, not `"1.0.0-rc2"`). Cosmetic — doesn't affect runtime behavior — but worth a deliberate decision rather than an oversight.

## How to use this document

Nothing above blocks creating or working with the `v1.0.0-rc2` tag/branch. It blocks the *next* milestone — promoting this code to a real, live, customer-facing production deployment. Work through CRITICAL and HIGH before that promotion; MEDIUM and LOW can follow shortly after if time pressure demands it, but shouldn't be forgotten once the excitement of a live launch moves attention elsewhere.
