# 09_VISIT_MANAGEMENT.md — Business Knowledge Base

Confirmed process for handling a site-visit request.

## When a customer requests a visit, capture

- Name
- Mobile
- Date
- Time
- Purpose
- Guest Count
- Budget

A Site Visit record should be created automatically from this data.

## Dashboard requirement

A Site Visit dashboard/list must show, per visit:

- Time
- Customer
- Property
- Purpose
- Mobile

## Status: built (Sprint 1/1.5/2, 2026)

Superseded from "not yet built" — this is now a shipped, tested capability. Reuses the existing `follow_ups` table (`type = 'site_visit'`, a value the `type` CHECK constraint has accepted since `007_missing_tables.sql`) rather than a new table, extended additively by migration 027 (`property`, `purpose`, `guest_count`, `budget` columns — **live status not yet independently verified, see `PRODUCTION_VERIFICATION_REPORT.md` §1 / ENG-033**).

- **Capture, automatic:** the AI chat conversation (`src/lib/ai.ts`'s `SYSTEM_PROMPT`, "SITE VISIT SCHEDULING" section) collects preferred date + time once the customer explicitly asks to visit — never proposed by the AI unprompted, per the AI Hospitality Sales Consultant Policy (`07_AI_BEHAVIOR_RULES.md`). `chat/route.ts` books it via `scheduleSiteVisit()` (`src/lib/visits/site-visit-service.ts`) once both values are known, using the same resolve-or-create-lead identity logic as the rest of the CRM.
- **Capture, manual:** `/visits/new` (staff-facing form) calls the identical `scheduleSiteVisit()`.
- **Duplicate guard:** `leadHasScheduledVisit()` blocks a second pending visit per lead — required because the AI re-emits the same visit_date/visit_time on every subsequent conversation turn once known.
- **Dashboard:** Today's Site Visits section on the Operations Dashboard (`/dashboard/operations`) shows Time/Customer/Property/Purpose/Guest Count/Budget per visit, plus a "Mark Completed" action.
- **Completion → Proposal:** marking a visit completed triggers `runVisitToProposalConversion()` (Sprint 2, Revenue Conversion Engine) — pre-fills the lead's guest_count/budget/venue from the visit (safe-fill, never overwrites), then runs the same Package Recommendation → Proposal Draft pipeline every other lead-qualification trigger uses, including the Property Intelligence hard guard (Skyline-never-events, Monurama-100-cap).

## Open questions (still genuinely open — not resolved by the build above)

**UNKNOWN — FOUNDER INPUT REQUIRED:**

- Any reminder/notification requirement (e.g., notify operator N hours before scheduled visit)? Not built — no notification job reads `follow_ups.type = 'site_visit'` today.
- Budget field format: currently free-text (`TEXT`, same convention as `leads.budget`), matching what was captured at scheduling time — confirmed as implemented, not re-opened, but never explicitly re-confirmed with the founder as the intended long-term format.

## Cross-references

- Implementation: `src/lib/visits/site-visit-service.ts`, `src/lib/leads/visit-to-proposal.ts`, `src/app/api/site-visits/[id]/route.ts`, `src/app/(crm)/dashboard/operations/page.tsx`.
- Migration: `supabase/migrations/027_site_visit_fields.sql` — live status: see `PRODUCTION_VERIFICATION_REPORT.md` §1 (ENG-033, Critical, unverified).
- Business rules: `10_BUSINESS_RULES.md` rows 11–12 (site visit is a customer choice; escalation triggers).
- Sprint record: `docs/sprints/2026-08-01_revenue-conversion-and-rc2-hardening.md`.
