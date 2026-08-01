# BookMySpaces CRM — Go-Live Checklist

Written 2026-08-01 for `release/v1.0.0-rc2` / v1.0. Run through this in order — the first two sections are ordered by actual severity found during this release's verification work (`PRODUCTION_VERIFICATION_REPORT.md`), not by convention. Every SQL file referenced here is read-only (`information_schema`/`pg_catalog` only) and safe to run against production any number of times.

---

## 1. Database — do these two checks FIRST, before anything else on this page

- [ ] **Run `scripts/verify-packages-columns.sql`** in the Supabase SQL Editor. **This is the single highest-priority item on this entire checklist.** A previously-documented (RC1-session) finding says the live `packages` table may use `property`/`price`/`capacity_max` instead of the `venue`/`base_price`/`max_guests` the application code reads by name. If confirmed, the Skyline-never-events and Monurama-100-cap safety guards silently never fire, and every AI-drafted proposal prices near ₹0. Do not proceed past this item until it returns PASS, or until the drift is reconciled (whichever is faster — see `PRODUCTION_VERIFICATION_REPORT.md`'s addendum for the exact fix options).
- [ ] **Run `scripts/verify-migrations-026-027.sql`.** Migration 027 is a hard-failure dependency of Site Visit Scheduling (named-column `INSERT`, not a graceful `SELECT *`) — if missing, every visit request errors. Migration 026 (campaign attribution) is lower severity but also unverified.
- [ ] **Run the one-shot query in `RC1_DEPLOYMENT_READINESS.md` §1 / `PRODUCTION_MIGRATION_STATE_VERIFICATION.md` §2** to resolve migrations 004 and 012–025 in one round trip. At minimum, confirm:
  - [ ] Is the **Reservation Platform** (migrations 012/013) in scope for this launch? If yes, it is **confirmed not live** as of the last check — must be applied (`npm run db:migrate:v3` then `npm run db:smoke-test:v3`) before enabling any reservation-facing feature.
  - [ ] Is **Campaigns** (migration 004, `/campaigns` page) in scope? If yes, confirm it's applied — the page 500s outright if not.
  - [ ] Migrations 016/017/024 — each has a documented **silent failure mode** if missing (orphaned proposals, silently-empty Lead Import, un-logged AI interactions respectively). Apply if not already live.
- [ ] Take a database backup (or confirm Supabase's automatic backup is current) before applying any migration found missing above.
- [ ] Apply missing migrations **in numeric order**, by hand via the Supabase SQL Editor for anything past 013 (the `npm run db:migrate:v3` script only covers 012/013 — do not assume it covers more, this is a documented, real tooling gap).
- [ ] After applying, re-run the relevant verification script to confirm PASS, not just "no error was thrown."

## 2. Schema drift — confirm, don't assume

- [ ] Re-verify `leads.lead_stage` and the 8 other columns `SCHEMA_DRIFT_REPORT.md` found live-but-unmigrated are still present (last checked 2026-07-11 — stale by launch time; the Founder Dashboard, Opportunity Score, and Kanban board all depend on `lead_stage` specifically).
- [ ] If Reservation Platform is in scope, resolve **ENG-004** (reservation pricing-zeroing bug) — do not launch reservation booking with this unresolved; it can under- or over-charge a guest.

## 3. Environment Variables

Full reference: `ENVIRONMENT_VARIABLES.md`. Launch-blocking (not optional):

- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — set correctly in **both** `.env.local`-equivalent and Vercel project settings. Confirm `.env.production.local` (if `vercel env pull` is used) does not silently override these with blank values — a previously-hit, documented root cause in this project's history.
- [ ] `ANTHROPIC_API_KEY` — required for the app to function at all (chat, extraction, Event Sales Advisor).
- [ ] `OPENAI_API_KEY` — required for embeddings/RAG and as the AI fallback provider.
- [ ] `CRON_SECRET` — **security-critical, fails open (zero auth) if unset.** Set identically in Vercel's Cron job configuration.
- [ ] `WHATSAPP_APP_SECRET` — **security-critical, fails open (accepts unsigned webhook requests) if unset.**
- [ ] `NEXT_PUBLIC_APP_URL` — set to the real production domain (used in proposal share links, post-logout redirects).

Recommended, not launch-blocking:

- [ ] `RESEND_API_KEY` / `EMAIL_FROM` — without these, proposal emails fall back to `mailto:` links.
- [ ] `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_SHEETS_ID` — lead sync to Sheets, optional.
- [ ] `META_APP_SECRET` / `META_VERIFY_TOKEN` / `META_PAGE_ACCESS_TOKEN` / `META_PAGE_ID` / `META_IG_ID` — Social module is credential-gated; safe to leave unset, Facebook/Instagram capture just stays inactive.

Confirm explicitly **unused** vars are not accidentally relied upon: `ADMIN_EMAIL`/`ADMIN_PASSWORD` (Supabase Auth handles login, not these), `NEXTAUTH_SECRET`, `WATI_VERIFY_TOKEN`/`WATI_WEBHOOK_SECRET`, `NEXT_PUBLIC_BUSINESS_PHONE`.

## 4. WhatsApp

- [ ] `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` set (Meta Cloud API — the live send/receive path).
- [ ] `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches exactly what's configured in the Meta App dashboard's webhook subscription.
- [ ] `WHATSAPP_APP_SECRET` set (see §3 — security-critical).
- [ ] Send one real test message through the webhook end-to-end (see §9 Smoke Tests).
- [ ] Confirm the legacy Wati.io variables (`WATI_BASE_URL`/`WATI_API_TOKEN`) are either set correctly (if `/api/health` or voice transcription is used) or explicitly accepted as unset.

## 5. Email

- [ ] `RESEND_API_KEY` set, and `EMAIL_FROM` is an address on a domain **verified in Resend** — an unverified domain will fail sends silently or bounce.
- [ ] Send one real test proposal email end-to-end and confirm delivery (see §9).
- [ ] If `RESEND_API_KEY` is intentionally left unset for this launch, confirm the team knows the fallback is a `mailto:` link, not a real send.

## 6. Supabase

- [ ] Automatic daily backups confirmed active (Settings → Database → Backups).
- [ ] RLS reviewed for any table this launch newly exposes to a session-scoped (non-`service_role`) client — `analytics_events` and `follow_ups` are known to have RLS **enabled with zero policies** (effectively deny-all except `service_role`); this is fine as long as every caller stays server-side/`service_role`, but would silently break if any future client-side query is added against either table without first adding a policy.
- [ ] Confirm the project's connection pooler/plan tier is appropriate for expected launch traffic (not assessed by this checklist — a capacity-planning decision, not a correctness one).

## 7. Cron Jobs

- [ ] `CRON_SECRET` set identically in the app's environment and in Vercel's Cron configuration for all 4 routes: `campaign-queue`, `escalations`, `followups`, `stay-lifecycle`.
- [ ] Confirm each cron route actually rejects a request with a missing/wrong `Authorization` bearer token (manual `curl` test recommended — do not assume from code review alone).
- [ ] Confirm Vercel Cron schedules are configured to actually fire (`vercel.json` or dashboard-configured) — a correctly-secured route that never runs is a different failure mode than an insecure one, check both.

## 8. Backups

- [ ] Supabase automatic backup confirmed current (see §6).
- [ ] One manual backup taken immediately before this go-live's migration step (§1), separate from the standing automatic schedule.
- [ ] Confirm someone on the team knows how to actually restore from a Supabase backup before it's ever needed under pressure — not assessed further by this checklist.

## 9. Monitoring

- [ ] Acknowledge: no APM/error-tracking service (Sentry or equivalent) is wired in as of this release (`MASTER_BACKLOG.md` ENG-023). If launching without one, explicitly decide who watches Vercel's function logs and how often.
- [ ] Confirm Vercel deployment logs are reachable by whoever is on call for launch day.
- [ ] Confirm `activity_logs`/`ai_interaction_log` are queryable (Supabase SQL Editor access) by the same person, as the practical substitute for real APM until ENG-023 is closed.

## 10. Security

- [ ] `CRON_SECRET` and `WHATSAPP_APP_SECRET` both set (repeated from §3/§7/§4 deliberately — these are the two most commonly-missed, most severe security gaps in this project's own history).
- [ ] `META_APP_SECRET` set if the Social module is enabled for this launch (fails closed if unset, so lower urgency than the two above, but confirm deliberately either way).
- [ ] Confirm no service-role key or other secret is present in any client-bundled (`NEXT_PUBLIC_*`) environment variable.
- [ ] Review `docs/engineering/MASTER_SECURITY.md` for any item not already covered above.

## 11. Smoke Tests — run against the live deployment after go-live migrations are applied

- [ ] Load the public landing page and start an AI chat conversation; confirm a lead is created in the CRM.
- [ ] In that same conversation, ask for pricing — confirm the AI answers from the packages it knows without creating a proposal.
- [ ] Ask the AI to schedule a site visit with a specific date and time; confirm it appears on the Operations Dashboard (`/dashboard/operations`).
- [ ] Mark that visit "Completed"; confirm a draft proposal appears on the Proposals page shortly after, with the **correct venue and a non-zero price** — this is the practical, end-to-end confirmation that §1's `packages`-drift check actually passed, not just that the SQL query said so.
- [ ] Attempt (via a test lead) a wedding enquiry for Skyline Serenity or a 150-guest Monurama event; confirm the system refuses to draft that specific proposal (check the customer's Timeline for the guard-refusal log entry).
- [ ] Open the Founder Dashboard; confirm all five sections render with real data, not errors or blank sections.
- [ ] Send one real WhatsApp message to the business number; confirm it appears in the unified Inbox.
- [ ] Send one real test proposal email from the Proposals page; confirm delivery.
- [ ] `curl` one cron route with no `Authorization` header; confirm it's rejected, not executed.
- [ ] Confirm `npm run build`, `tsc --noEmit`, `npm run lint`, and `vitest run` were all run and green in the actual deployment pipeline (Vercel's build step counts; this project's own sandbox testing does not fully substitute for it — ENG-005).

---

## Release Recommendation

**READY FOR INTERNAL USE.** Application-layer logic is fully validated end-to-end (`RC2_READINESS_REPORT.md`) and the AI Hospitality Sales Consultant Policy is live. This is **not** yet READY FOR PRODUCTION (guest-facing, revenue-bearing launch) until §1's two Critical checks — `packages` column drift and migration 027 — are run and resolved; both are fast (minutes), read-only, and already written, so this is a short gap to close, not a structural blocker. The Reservation Platform specifically should stay out of scope for a guest-facing launch until migrations 012/013 are confirmed applied.
