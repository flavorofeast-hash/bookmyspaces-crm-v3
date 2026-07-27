# DEPLOYMENT.md — Production Deployment Guide

Last updated: 2026-07-27 (Release Candidate hardening pass). This is the procedural how-to-deploy guide. For the step-by-step pre-launch checklist (what must be true before you deploy), see `DEPLOYMENT_CHECKLIST.md`. For local setup, see `INSTALL.md`.

## Target platform

Next.js 14 App Router, deployed to **Vercel**. Database is **Supabase Postgres**.

## 1. Push to GitHub

```bash
git add .
git commit -m "Release Candidate v1.0"
git push origin main
```

## 2. Create the Vercel project

1. [vercel.com](https://vercel.com) → Import the GitHub repo.
2. Framework preset: Next.js (auto-detected).
3. Add every environment variable from `.env.local` into Vercel → Project → Settings → Environment Variables. See `ENVIRONMENT_VARIABLES.md` for the full list and which ones are security-critical (`WHATSAPP_APP_SECRET`, `CRON_SECRET` — both fail open, not closed, if left unset).
4. Set `NEXT_PUBLIC_APP_URL` to your real production domain (this is the one variable the app uses to build share links and post-logout redirects).

## 3. Apply database migrations

**Do this before or immediately after the first deploy, not after real traffic starts.** See `PRODUCTION_MIGRATION_CHECKLIST.md` for the full table of what each migration does and its dependencies. Summary:

```bash
npm run db:migrate:v3
npm run db:smoke-test:v3
```

Migrations 001-011 predate this tooling and are expected to already be live. Migrations 012-024 are additive and idempotent — safe to run in one batch, safe to re-run if interrupted.

## 4. Vercel Cron (already configured in `vercel.json`)

The 4 cron routes are already scheduled in `vercel.json`'s `crons` array — `followups` (daily 9am), `escalations` (daily 6pm), `campaign-queue` (hourly), `stay-lifecycle` (daily 8am), all IST-relative to the `bom1` (Mumbai) region also set there. Nothing to configure manually as long as this repo's `vercel.json` deploys as-is. The one thing that **does** need manual attention: set `CRON_SECRET` in step 2's environment variables — every cron route checks it, but **fails open with zero authentication if it's left unset**, see `SECURITY_REVIEW.md`.

## 5. Configure external webhooks

- **WhatsApp (Meta Cloud API):** in the Meta App dashboard, set the webhook URL to `https://<your-domain>/api/whatsapp/webhook` and the verify token to match `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Also set `WHATSAPP_APP_SECRET` — without it, inbound webhook signature verification is skipped (with a warning logged), not enforced.
- **Social (Facebook/Instagram Lead Ads, Messenger, IG DM):** webhook URL is `https://<your-domain>/api/social/webhook/[platform]`. Verification is per-platform via the adapter pattern (`src/lib/social/`) — consult the Meta App dashboard for the exact subscription fields needed per platform.

## 6. Deploy

Vercel deploys automatically on push once the project is connected, or trigger manually from the dashboard.

## 7. Post-deploy smoke tests

1. Visit `/api/health` — confirm Supabase, Anthropic, and OpenAI all report healthy.
2. Log into the CRM (`/dashboard` or the app's sign-in route) and confirm the sidebar/`UserMenu` shows your account.
3. Send a test WhatsApp message to the connected number and confirm it appears in the Inbox.
4. Create a test lead via the website chat widget and confirm it appears in the Kanban board.
5. Open a proposal's share link in an incognito/private window (no login) and confirm it loads — this is the one fully public, customer-facing page in the app.
6. Run `npm run db:smoke-test:v3` again against production if you haven't already post-migration.

## Rollback procedure

- **Code:** Vercel keeps every deployment; use "Promote to Production" on the last known-good deployment from the Vercel dashboard's Deployments tab — this is effectively instant and doesn't touch the database.
- **Database:** every migration 012-024 has a matching `_ROLLBACK.sql` file in `supabase/migrations/`. Rollbacks are additive-reversal only (they drop what the migration added; they do not attempt to restore data, since none of these migrations delete or transform existing data). Run via `npm run db:rollback:v3`.
- **Cron/webhooks:** disabling a specific integration (e.g., pausing WhatsApp) doesn't require a redeploy — remove or invalidate the relevant credential (e.g., rotate `WHATSAPP_APP_SECRET`) and the corresponding webhook will start rejecting requests immediately.

## Monitoring

No dedicated APM/error-tracking service is wired in as of this release. At minimum, monitor: Vercel's own function logs (structured via `src/lib/logger.ts` — every log line is `logger.info/warn/error(scope, message, data)`, searchable by scope), Supabase's dashboard for database errors/slow queries, and `/api/health` as a manual or externally-polled uptime check. Adding a real error-tracking integration (Sentry or similar) is a reasonable near-term follow-up, not implemented in this pass since it requires a new external credential this sandbox can't provision.

## Backups

Rely on Supabase's automatic daily backups (confirm your plan tier includes the retention window you need) plus a manual backup immediately before applying migrations 012-024, per `PRODUCTION_MIGRATION_CHECKLIST.md`'s pre-migration checklist.
