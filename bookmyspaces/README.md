# BookMySpaces CRM V3

An AI-powered event sales and hospitality CRM for BookMySpaces (Kolkata) — Skyline Serenity and Monurama Homestay — covering event bookings, direct room bookings, WhatsApp/social conversions, proposal generation, and repeat-customer marketing, all grounded in one customer timeline.

Status: **Release Candidate 2** (2026-08-01). See `VERSION_1_RELEASE_NOTES.md` for the full v1.0 release package, `GO_LIVE_CHECKLIST.md` before deploying, and `PRODUCTION_VERIFICATION_REPORT.md` for the current, unresolved production-database risks — most notably ENG-035 (`packages` schema drift may make safety guards silently inert) and ENG-033 (Site Visit scheduling's migration never verified live). `RELEASE_REPORT.md` (2026-07-27) remains the RC1-era assessment; superseded for anything the newer documents cover, not deleted, per this project's own non-destructive documentation convention.

## What this is

Not an OTA or channel manager — this CRM exists to maximize direct event bookings, direct room bookings, and repeat business, with AI doing the qualification/recommendation/drafting work and humans keeping approval control over anything customer-facing.

## Core features

- **AI-first omnichannel intake** — website chat, WhatsApp (Meta Cloud API), and Facebook/Instagram Lead Ads + Messenger + DM, all resolved to one customer identity, one timeline.
- **Direct Event Sales Engine** — AI Event Sales Advisor recommends a package from live inventory (venue/hall/capacity/seating/menu/decor/AV/rooms/add-ons/seasonal pricing), auto-drafts a proposal, tracks recommendation success rate against actual bookings.
- **Reservation Platform** — rooms, halls, meal plans, add-on services, availability engine, invoicing, taxes.
- **Revenue Intelligence** — sales funnel, revenue forecast, proposal/booking/customer analytics, sales productivity, event revenue by hall/venue/package/lead-source/campaign.
- **Customer Journey Automation** — 9-stage lifecycle (welcome through win-back), fully automatic, campaign-driven.
- **Campaign Scheduler** — queue-based sends, pause/resume/cancel, recurring campaigns, birthday/anniversary/dormant segmentation.
- **Operator tooling** — Kanban lead pipeline, unified inbox, AI-assisted replies (suggest/rewrite/translate/tone), audit logging.

## Getting started

New to this codebase? Start with `INSTALL.md` for local setup. For production deployment, see `DEPLOYMENT.md` and `DEPLOYMENT_CHECKLIST.md`.

```bash
npm install
cp .env.example .env.local   # fill in your keys — see ENVIRONMENT_VARIABLES.md
npm run dev
```

## Documentation map

**Start here — the current, maintained set:**

| Doc | Covers |
|---|---|
| `docs/engineering/` (the **Engineering OS**) | Canonical, standing-state reference: `MASTER_ARCHITECTURE.md`, `MASTER_DATABASE.md`, `MASTER_AI.md`, `MASTER_API.md`, `MASTER_SECURITY.md`, `MASTER_UI.md`, `MASTER_CODING_STANDARDS.md`, `MASTER_PRODUCT.md`, `MASTER_ROADMAP.md`, `MASTER_BACKLOG.md`. Read these before the legacy root docs below — they consolidate and correct them. |
| `docs/business/` (the **Business Knowledge Base**) | Canonical business rules: property intelligence, packages, pricing, discount policy, sales/marketing playbooks, AI behavior policy, standard responses, visit management, master rule index. |
| `docs/sprints/` | Dated, append-only record of what actually happened, session by session. |
| `docs/releases/` | Dated record of what actually shipped to a real environment, one file per release. |
| `VERSION_1_RELEASE_NOTES.md` | The v1.0 release package — features, architecture, AI/business capabilities, known limitations, deployment steps, rollback, roadmap. |
| `OPERATIONS_RUNBOOK.md` | Day-to-day operations: lead management, proposal workflow, site visits, Founder Dashboard, backup, monitoring, troubleshooting, recovery. |
| `GO_LIVE_CHECKLIST.md` | Pre-launch checklist — database, env vars, WhatsApp, email, cron, backups, monitoring, security, smoke tests. |
| `RC2_READINESS_REPORT.md` | End-to-end validation of 8 required customer journeys against real code. |
| `PRODUCTION_VERIFICATION_REPORT.md` | Production database verification — migration state, schema drift, module-by-module grading. **Read before deploying** — currently records two Critical, unresolved, unverified risks (ENG-033, ENG-035). |
| `ENVIRONMENT_VARIABLES.md` | Every env var, what it's for, which ones are security-critical |
| `INSTALL.md` | Local development setup, step by step |

**Historical / superseded** — preserved for their analysis and audit trail, not deleted, per this project's own non-destructive documentation convention (`docs/engineering/MASTER_DATABASE.md`'s Database Evolution Policy). Where these disagree with the Engineering OS or the docs above, the newer document wins:

`RELEASE_REPORT.md`, `RELEASE_REPORT_GLP.md`, `RC1_DEPLOYMENT_READINESS.md`, `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md`, `BOOKMYSPACES_V3_MASTER_SPECIFICATION.md`, `AI_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`, `ARCHITECTURE.md`, `API_SPECIFICATION.md`, `SOCIAL_MEDIA_ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`, `SECURITY_REVIEW.md`, `PERFORMANCE_REVIEW.md`, `UI_UX_REVIEW.md`, `WORKFLOW_VERIFICATION.md`, `PRODUCTION_MIGRATION_CHECKLIST.md`, `DEPLOYMENT.md`, `DEPLOYMENT_CHECKLIST.md`, `PRODUCTION_CHECKLIST.md`, and the `*_VALIDATION.md` files at the repo root — all folded into or superseded by `docs/engineering/`, `PRODUCTION_VERIFICATION_REPORT.md`, and `GO_LIVE_CHECKLIST.md`, and the `audit/` directory's own trail.

## Testing

```bash
npm run test
```

## Business contact info (built into the app's chat/proposal templates)

BookMySpaces · Mukundapur, near EM Bypass, Kolkata · www.bookmyspaces.in · 9051459463 / 9830509991
