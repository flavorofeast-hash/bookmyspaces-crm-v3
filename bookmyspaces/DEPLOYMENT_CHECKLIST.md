# DEPLOYMENT_CHECKLIST.md — Production Go-Live Checklist

Last updated: 2026-07-27 (Release Candidate hardening pass). This is the step-by-step checklist to work through before and during the first production launch. For the procedural how-to behind each step, see `DEPLOYMENT.md`; for what "code-ready" means, see `PRODUCTION_CHECKLIST.md`.

## Environment Variables

- [ ] Every variable in `.env.example` reviewed against `ENVIRONMENT_VARIABLES.md` and set in Vercel → Project → Settings → Environment Variables (not just `.env.local`).
- [ ] `WHATSAPP_APP_SECRET` set — **fails open (accepts unsigned webhook requests) if blank.**
- [ ] `CRON_SECRET` set — **fails open (zero auth on all 4 cron routes) if blank.**
- [ ] `NEXT_PUBLIC_APP_URL` set to the real production domain (used for proposal share links and logout redirects).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` confirmed present only in server-side env vars, never in a `NEXT_PUBLIC_*` variable.

## Supabase

- [ ] Production project created (separate from any dev/staging project).
- [ ] `vector` extension enabled (Database → Extensions).
- [ ] Automatic backups confirmed enabled, retention window checked against your plan tier.
- [ ] Manual backup taken immediately before running the migration batch below.
- [x] ~~Storage bucket `documents` created~~ — not needed; corrected during Go-Live prep. Knowledge base content lives in a `documents` Postgres table (`src/lib/documents.ts`), not Supabase Storage. Confirmed via grep: no `.storage.from(...)` call exists anywhere in `src`.

## Database Migrations

- [ ] **Verify against the live DB directly, don't assume from this doc** (per `DATABASE_ARCHITECTURE.md`'s standing rule): confirm `broadcast_campaigns` and `festival_calendar` (migration 004) actually exist before assuming 001-011 are fully live. A prior session flagged these as possibly never applied, which would make the nav-linked Campaigns page 500 on every action — see `PRODUCTION_MIGRATION_CHECKLIST.md`'s "Current state" section. If missing, include migration 004 in the batch below.
- [ ] Confirm current state: 001-011 assumed live (verify per above), 012-024 pending.
- [ ] Run `npm run db:migrate:v3` (applies 012-024 in order; all idempotent, safe to re-run).
- [ ] Run `npm run db:smoke-test:v3`.
- [ ] Spot-check migration 020: create a test campaign with `type: 'birthday'` — must succeed.
- [ ] Spot-check migration 024: trigger the AI Event Sales Advisor, then confirm a row appears in `ai_interaction_log` with `interaction_type = 'event_sales_advisor'`.
- [ ] Confirm `packages.addon_service_ids`, `packages.hall`, `packages.seasonal_pricing` exist (backs the Smart Proposal Generator).
- Full detail: `PRODUCTION_MIGRATION_CHECKLIST.md`.

## GitHub

- [ ] **Important:** the folder this RC pass worked in has no `.git` directory — every file change made during this pass (and, per `audit/ENGINEERING_WORKSPACE_CURRENT_STATE.md`, every prior AI-assisted session on this project) exists only as edited files on disk, not as commits. Before deploying, diff this folder against your actual git checkout, review the changes, and commit them yourself from an environment that has the real repo. Don't assume "the code is ready" means "the code is committed" — confirm both.
- [ ] All RC-pass changes committed and pushed to `main` (or your deploy branch), once diffed and reviewed per above.
- [ ] Vercel project connected to the correct repo/branch.

## Vercel

- [ ] Project imported, framework auto-detected as Next.js.
- [ ] `vercel.json`'s `crons` array deploys as-is (already configured: `followups` daily 9am, `escalations` daily 6pm, `campaign-queue` hourly, `stay-lifecycle` daily 8am, region `bom1`).
- [ ] Region (`bom1` / Mumbai) still appropriate for your actual user base — confirm, don't assume.
- [ ] First deploy triggered and build succeeds (this is the authoritative build check — the sandbox that produced this RC pass could not reliably run `npm run build` itself; see `PRODUCTION_CHECKLIST.md`).

## Cron Jobs

- [ ] All 4 cron routes (`campaign-queue`, `escalations`, `followups`, `stay-lifecycle`) confirmed firing on schedule post-deploy (check Vercel's Cron Jobs dashboard for execution history after the first scheduled run).
- [ ] `CRON_SECRET` confirmed matching between the env var and what Vercel sends (Vercel Cron sends it automatically once the env var is set — no separate config needed).

## Webhooks

- [ ] WhatsApp webhook URL (`https://<domain>/api/whatsapp/webhook`) registered in the Meta App dashboard.
- [ ] `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches exactly between `.env` and the Meta dashboard.
- [ ] Social webhook URL (`https://<domain>/api/social/webhook/[platform]`) registered per platform (Facebook Lead Ads, Messenger, Instagram DM) per `SOCIAL_MEDIA_ARCHITECTURE.md`.
- [ ] Send a real test message/lead through each connected channel post-deploy and confirm it lands in the CRM.

## WhatsApp / Meta

- [ ] Meta Business/App verified and out of any sandbox/test mode restrictions that would block real customer numbers.
- [ ] `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are the production (not test) values.
- [ ] Business WhatsApp number displayed in the app (`NEXT_PUBLIC_BUSINESS_WHATSAPP`) matches the real number customers should message.

## Google (Sheets sync)

- [ ] Service account created, Sheets API enabled, target sheet shared with the service account email (Editor access).
- [ ] `GOOGLE_PRIVATE_KEY`'s `\n` escapes intact after pasting into Vercel's env var UI (a common corruption point — verify a test lead actually syncs).

## Resend (email)

- [ ] `RESEND_API_KEY` set and sending domain verified in Resend (not using the shared testing address for real customer email).
- [ ] `EMAIL_FROM` set to a verified address on that domain.
- [ ] Send one real test email (e.g., a test proposal) and confirm delivery + that it doesn't land in spam.

## AI Keys

- [ ] `ANTHROPIC_API_KEY` — production key, billing/rate limits appropriate for expected volume.
- [ ] `OPENAI_API_KEY` — production key, used for embeddings + fallback.
- [ ] `/api/health` checked post-deploy and reports both providers healthy.

## Smoke Tests (post-deploy)

- [ ] `/api/health` — all services green.
- [ ] Log into the CRM, confirm the account shown in `UserMenu` (sidebar) is correct.
- [ ] Create a test lead via website chat → confirm it appears on the Kanban board.
- [ ] Send a test WhatsApp message → confirm it appears in the Inbox and gets an AI response.
- [ ] Trigger the AI Event Sales Advisor on a test lead → confirm a draft proposal appears.
- [ ] Open a proposal's share link in a private/incognito window (no login) → confirm it loads and shows the new loading skeleton briefly on a throttled connection.
- [ ] Download a proposal PDF → confirm room/add-on names render correctly (verifies the XSS-escaping fix didn't break normal names).
- [ ] Check the Revenue Dashboard loads without error (exercises the full-table-scan aggregation queries under real data volume for the first time).

## Rollback Procedure

- [ ] Confirmed how to promote a prior Vercel deployment (Deployments tab → "Promote to Production") — practice this once in a non-critical moment, don't learn it for the first time during an incident.
- [ ] Confirmed `npm run db:rollback:v3` works against a non-production copy before you'd ever need it against production (every 012-024 migration has a paired `_ROLLBACK.sql`).

## Monitoring

- [ ] `/api/health` bookmarked or wired into an external uptime check (no dedicated APM is configured in this release — see `DEPLOYMENT.md`'s Monitoring section for why and what a good follow-up looks like).
- [ ] Team knows where to find logs (Vercel function logs, structured via `src/lib/logger.ts` scopes) for post-incident debugging.

## Backups

- [ ] Supabase automatic backup confirmed active and retention window understood.
- [ ] One manual backup taken immediately before the migration batch (see Database Migrations section above) — this is the one you'd actually restore from if something in 012-024 went wrong.

## Sign-off

Once every box above is checked (or explicitly accepted as a known, documented risk — e.g., "we're launching without APM and that's OK for now"), this release is ready to go live. See `RELEASE_REPORT.md` for the overall readiness score and recommended version number.
