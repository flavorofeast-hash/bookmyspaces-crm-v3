# BookMySpaces CRM V3

An AI-powered event sales and hospitality CRM for BookMySpaces (Kolkata) — Skyline Serenity and Monurama Homestay — covering event bookings, direct room bookings, WhatsApp/social conversions, proposal generation, and repeat-customer marketing, all grounded in one customer timeline.

Status: **Release Candidate v1.0** (2026-07-27). See `RELEASE_REPORT.md` for the full production-readiness assessment.

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

| Doc | Covers |
|---|---|
| `INSTALL.md` | Local development setup, step by step |
| `DEPLOYMENT.md` | Production deployment procedure (Vercel + Supabase) |
| `DEPLOYMENT_CHECKLIST.md` | Pre-launch go-live checklist |
| `PRODUCTION_CHECKLIST.md` | Code-readiness checklist (quality/build/tests/security/perf) |
| `ENVIRONMENT_VARIABLES.md` | Every env var, what it's for, which ones are security-critical |
| `ARCHITECTURE.md` | Pointer to the full architecture doc set |
| `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md` | Full system architecture, layering, principles |
| `AI_ARCHITECTURE.md` | AI provider layer, grounding, orchestration, Direct Event Sales Engine AI |
| `DATABASE_ARCHITECTURE.md` | Schema, migration inventory, RLS |
| `PRODUCTION_MIGRATION_CHECKLIST.md` | Migration apply order, dependencies, rollback |
| `API_SPECIFICATION.md` | API route inventory and conventions (serves as the API reference) |
| `SECURITY_REVIEW.md` | Security posture and RC-pass findings |
| `PERFORMANCE_REVIEW.md` | Query patterns, N+1 audit, known scaling considerations |
| `UI_UX_REVIEW.md` | Loading/empty/error state and accessibility audit |
| `WORKFLOW_VERIFICATION.md` | Every business workflow traced end-to-end against actual code |
| `RELEASE_REPORT.md` | Overall production-readiness assessment, risk register, version recommendation |

## Testing

```bash
npm run test
```

## Business contact info (built into the app's chat/proposal templates)

BookMySpaces · Mukundapur, near EM Bypass, Kolkata · www.bookmyspaces.in · 9051459463 / 9830509991

