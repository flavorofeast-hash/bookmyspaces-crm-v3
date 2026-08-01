# BookMySpaces CRM — Operations Runbook

Written 2026-08-01 for `release/v1.0.0-rc2` / v1.0. Audience: whoever runs the business day-to-day (founder, operations staff) and whoever supports the system technically. This is the "how do I actually use/fix this" document — for what the system is and why, see `VERSION_1_RELEASE_NOTES.md`; for business rules, see `docs/business/`; for pre-launch verification, see `GO_LIVE_CHECKLIST.md`.

---

## Daily Operations

**Morning:** open the Founder Dashboard (`/dashboard/founder`). Read the AI Morning Brief first — it's deterministic (not another AI call re-guessing numbers the system already has), built from the same Opportunity Score and Revenue Intelligence data as the rest of the dashboard. Check Today's Schedule (one merged timeline of site visits, follow-ups due, and proposal reviews) and Today's Opportunities (sorted by Revenue Probability) to decide what to act on first.

**Throughout the day:** the Kanban lead pipeline (`/kanban`) and unified Inbox (`/inbox`) are the working views for actively managing conversations. New leads arrive automatically from website chat, WhatsApp, and (if configured) Facebook/Instagram — no manual entry needed for those channels.

**End of day / weekly:** Revenue Intelligence (`/dashboard/revenue`) for the sales funnel, forecast, and productivity view. Lost Revenue Summary (on the Founder Dashboard) for what's slipping — read "Insufficient data" fields honestly; they mean the underlying data doesn't exist yet, not zero.

---

## Lead Management

Leads arrive from: website AI chat, WhatsApp, website enquiry form, Facebook/Instagram Lead Ads/Messenger/DM (if configured), and Excel import. All channels resolve to one `leads` row per real customer via phone/email dedup (`upsertLead`/`captureLeadWithJourney`/`resolveIdentity`) — you should never see the same customer as two separate lead cards from two different channels.

**Lead stage** (`leads.lead_stage`): NEW → CONTACTED → QUALIFIED → NEGOTIATING → PROPOSAL_SENT → VISIT_SCHEDULED → CONFIRMED, or LOST at any point. This drives the Kanban board, the sales funnel, and the Opportunity Score.

**Opportunity Score / Revenue Probability** (0–100, shown on the customer detail page and Founder Dashboard): a deterministic score, not an AI guess, computed from qualification completeness, proposal status, follow-up engagement, customer value, repeat-customer bonus, site-visit engagement, and proposal-engagement (whether they've viewed it). Higher means more likely to book — use it to prioritize who to call first, not as a guarantee.

**If a lead looks wrong or stuck:** check the Timeline on the customer detail page first — every automated action (lead capture, visit scheduled, proposal drafted, follow-up sent) logs an `activity_logs` entry there, so you can see exactly what the system did and when, rather than guessing.

---

## Proposal Workflow

**How a proposal gets drafted (automatic):** once a lead has an event type and no existing proposal, the system runs the AI Event Sales Advisor and — if it confidently names a real catalog package — creates a **draft** proposal automatically. This happens after lead qualification (any channel) and after a site visit is marked Completed. It never happens for Skyline Serenity event proposals (accommodation-only, hard-guarded) or for Monurama proposals above 100 guests (hard-guarded) — if you see neither happened for a lead that should have gotten one, check whether it hit one of those two guards (an `activity_logs`/error-log entry records the refusal) before assuming something's broken.

**Owner Review:** every AI-drafted proposal is `status: 'draft'` — nothing is ever sent to a customer without a human opening it on the Proposals page (`/proposals`) and clicking Send. This is a hard rule (`docs/business/07_AI_BEHAVIOR_RULES.md` / `MASTER_ARCHITECTURE.md`'s AI Safety & Approval Layer), not a setting you can turn off.

**Sending:** WhatsApp, email, and PDF generation are all available from the Proposals page once you've reviewed a draft. Track views (`first_viewed_at`) and status (draft → sent → viewed → accepted/rejected/expired) from the same page.

**If a proposal's price or venue looks wrong:** this is the single most important thing to check before trusting any proposal in production — see `GO_LIVE_CHECKLIST.md`'s database section on the `packages` table. A known, previously-flagged (and not yet re-verified) schema-drift risk means package pricing/venue could silently compute incorrectly if the live `packages` table's columns don't match what the code expects.

---

## Site Visits

**Scheduling:** either the AI books it conversationally (customer asks to visit, gives a date and time, the AI confirms and it appears on the Operations Dashboard automatically) or staff use `/visits/new` directly. Both paths create the same kind of record and can't double-book the same lead — the system blocks a second pending visit per lead automatically.

**Today's Site Visits** (Operations Dashboard, `/dashboard/operations`): shows time, customer, property, purpose, guest count, and budget for every visit. Click **Mark Completed** once the visit actually happens.

**What happens when you mark a visit Completed:** the system automatically fills in any of the lead's guest count/budget/venue fields that were still empty (using what was captured at the visit — it never overwrites data you already had), then runs the same Package Recommendation → Proposal Draft pipeline lead qualification uses. Check the Proposals page shortly after — a new draft should appear if the lead has an event type and didn't already have one. If nothing appears, check the customer's Timeline for a guard-refusal log entry (Skyline/capacity) before assuming it's broken.

**If site visits stop working entirely** (visits can't be created, or the form errors): this is the highest-priority thing to check in `GO_LIVE_CHECKLIST.md` — migration 027 (the columns this feature depends on) has never been confirmed live in production as of this release. See Troubleshooting below.

---

## Founder Dashboard

Five sections, `/dashboard/founder`:

1. **Today's Opportunities** — customer, event, Revenue Probability, expected revenue, property, and next action, sorted to surface what needs attention today.
2. **Revenue Pipeline** — Leads → Visits → Draft Proposals → Sent Proposals → Negotiation → Bookings, each with count and revenue.
3. **Today's Schedule** — one merged, time-sorted timeline of site visits, follow-ups due, and proposals awaiting review (undated items sort to the bottom, not hidden).
4. **AI Morning Brief** — a plain-language summary built deterministically from the same data as the rest of the dashboard, not a separate AI call re-guessing.
5. **Lost Revenue Summary** — total value/count of lost leads and lost proposals, with a "No Follow-up" figure that's real (derived from `follow_up_count`), and every other reason category explicitly marked "Insufficient data" rather than invented.

If any section looks empty or wrong, the underlying data source is one of: `leads`, `proposals`, `follow_ups` — check those tables' live state (via `GO_LIVE_CHECKLIST.md`'s verification queries) before assuming the dashboard logic itself is broken; it reuses the same Revenue Intelligence and Opportunity Score functions used everywhere else in the CRM, so a dashboard-only bug (as opposed to a data problem) is unlikely by construction.

---

## Backup

Supabase's automatic daily backups should be confirmed active in the Supabase project dashboard (Settings → Database → Backups) before go-live — this CRM has no application-level backup mechanism of its own; it relies entirely on Supabase's. Take a manual backup before applying any migration, even an additive one, as standing practice.

---

## Monitoring

No APM/error-tracking service (Sentry or equivalent) is wired in as of this release — flagged in `MASTER_BACKLOG.md` (ENG-023) as a known gap, highest safety-per-effort item not yet done. Until it is, the practical monitoring surface is: Vercel's own function logs (for 500s/crashes), the Supabase dashboard's own query/error logs, and the CRM's own `activity_logs`/`ai_interaction_log` tables (queryable directly in the Supabase SQL Editor) for a record of what the system did and when. Check Vercel's deployment logs first for anything that looks like an outright failure (blank page, 500 response); check `activity_logs` for anything that looks like a silent logic gap (an action that should have happened but didn't).

---

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Site visit request fails, or `/visits/new` errors | Migration 027 not live (never verified as of this release) | Run `scripts/verify-migrations-026-027.sql` in the Supabase SQL Editor |
| A proposal drafts with the wrong venue, or Skyline gets recommended for an event | `packages` table schema drift (`venue` column may not exist under that name live) — a previously-flagged, not yet re-verified risk | Run `scripts/verify-packages-columns.sql` |
| A proposal drafts at ₹0 or near-₹0 | Same `packages` drift as above (`base_price` column) | Same check |
| Reservation creation 502s, or the Reservations dashboard shows all zeros | Migrations 012/013 (Reservation Platform) confirmed not live in production | See `PRODUCTION_VERIFICATION_REPORT.md` §1; this is a known, standing gap, not new |
| `/campaigns` page 500s | Migration 004 possibly not live | See `RC1_DEPLOYMENT_READINESS.md` §1 |
| Excel Lead Import reports success but no leads appear | Migration 017 possibly not live (historically the most severe finding of this kind — silent zero-write) | See `PRODUCTION_MIGRATION_STATE_VERIFICATION.md` §4 |
| A standalone proposal for a brand-new customer doesn't show on the Customers page | Migration 016 possibly not live (`leads.source = 'proposal'` check-constraint violation, fails open to `lead_id: NULL`) | Same document |
| WhatsApp webhook not receiving messages | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` mismatch, or `WHATSAPP_APP_SECRET` unset (accepts unsigned requests instead of rejecting — a security gap, not a delivery failure) | `ENVIRONMENT_VARIABLES.md` |
| Cron jobs (campaign queue, escalations, follow-ups, stay-lifecycle) not running, or running for anyone | `CRON_SECRET` unset in this environment — fails open with zero authentication | `ENVIRONMENT_VARIABLES.md`, `GO_LIVE_CHECKLIST.md` |
| AI chat gives a generic/fallback message repeatedly | `ANTHROPIC_API_KEY` invalid/exhausted — should silently fail over to OpenAI; if both are failing, check both keys | `ENVIRONMENT_VARIABLES.md` |

---

## Recovery Procedures

**Application-level failure (bad deploy):** promote the previous Vercel deployment from the Vercel dashboard — fastest recovery path, no database involvement.

**Data-level problem (bad migration):** run the paired `_ROLLBACK.sql` file for the specific migration via the Supabase SQL Editor. Every migration in this project has one. Understand before running one that it's a `DROP COLUMN`/`DROP TABLE` — any data written since the forward migration went live is permanently lost; this is a last resort, not a routine action.

**Suspected data corruption or unexpected mass-write:** stop, do not attempt an ad hoc fix. Confirm Supabase's automatic backup is current, take a manual backup/point-in-time-recovery snapshot if the situation warrants it, and restore from Supabase's backup tooling rather than trying to hand-write a corrective SQL script under time pressure.

**"The AI did something it shouldn't have" (e.g., seemed to violate a business rule in conversation):** because every AI-drafted artifact requires human approval before anything customer-facing sends, a conversational misstep by itself cannot directly harm a customer — check the Timeline/`activity_logs` for what was actually written to the database (as opposed to just said in chat), and whether the Property Intelligence guard actually fired (it's enforced in code, not just prompt text, for anything that reaches a proposal draft). If the guard failed to fire on a real proposal, treat it as the `packages`-drift Critical risk described above and in `GO_LIVE_CHECKLIST.md`, not as a one-off AI mistake.
