# MASTER_PRODUCT.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Part of the permanent Engineering OS (`docs/engineering/`). This is the canonical WHAT-is-this-product document, meant to remain accurate for years, not one RC pass. It consolidates `BOOKMYSPACES_V3_MASTER_SPECIFICATION.md` and the growth-platform vision in `docs/growth/02_PRODUCT_VISION.md` into one durable reference — those documents are not deleted or contradicted, but this is the document a new engineer should read first.

**Deployment model**: Current deployment model: single tenant (one operator, two properties). Architecture should allow future multi-property/multi-tenant evolution without rewrite — this is a design constraint on `MASTER_ARCHITECTURE.md`/`MASTER_DATABASE.md` going forward (favor patterns that don't hard-code "one operator" assumptions where the cost of avoiding that is low), not a commitment that multi-tenancy is on the roadmap. See `MASTER_ROADMAP.md`'s non-goals for the current phase sequencing, which still treats multi-tenant SaaS as out of scope until a deliberate product decision says otherwise.

## Mission

Give a small, single-operator hospitality business (Skyline Serenity, Monurama Homestay) the same caliber of AI-assisted CRM, marketing, and revenue-operations tooling that only large hotel groups or SaaS-subscribing enterprises could historically afford — by unifying every guest touchpoint (chat, WhatsApp, social, proposals, reservations) around one customer timeline, and by using AI to do the repetitive work (answering, qualifying, drafting, recommending) so operators spend their time on judgment calls, not data entry. Every module in this Engineering OS exists in service of that mission; where a proposed change doesn't clearly serve it, that's a reason to question the change, not the mission.

## Success Metrics

Recorded so "growth" and "engineering health" have a shared, checkable definition rather than being judged impressionistically. These are the metrics `MASTER_ROADMAP.md`'s Business Outcomes and Release Gates are ultimately in service of:

- **Guest experience**: response time to first contact (any channel), AI-vs-human resolution rate, human-handoff rate and reason breakdown, guest-reported satisfaction (once review/CSAT capture exists — see `docs/growth/16_REVIEW_MANAGEMENT.md`).
- **Revenue**: booking conversion rate (lead → proposal → reservation), average booking value, repeat-guest rate, referral-sourced revenue (once `docs/growth/14_REFERRAL_SYSTEM.md` ships) — all already computable in part from `revenue-intelligence.ts`/`lifetime-value.ts`, per `MASTER_ARCHITECTURE.md`.
- **Operational health**: proportion of "presumed live" claims independently re-verified per release (see `MASTER_DATABASE.md`'s central caution), open `MASTER_BACKLOG.md` Critical/High items at any given time, build/test/lint green rate at phase-end.
- **Platform reach**: channels unified onto one timeline (today: WhatsApp + website chat; target: + social DM + email, per `MASTER_ROADMAP.md` Phase 4), AI-assisted operator actions per week (once `docs/growth/06_AI_SALES_ASSISTANT.md` ships, a directly instrumentable number via `ai_interaction_log`).

These are intentionally qualitative-with-a-clear-source-of-data rather than hard numeric targets in this document — setting actual targets (e.g., "20% repeat-guest rate by Q3") is a business decision for the product owner, not something to fabricate here. Record real targets in a dated `docs/releases/` or `docs/sprints/` entry once the business sets them, and cross-reference from here.

## What BookMySpaces is

An AI-powered omnichannel hospitality operations and growth platform — CRM, property/booking management, AI customer engagement, marketing automation, and business intelligence unified around one customer profile with one timeline. Business: hospitality (hotel/homestay/banquet/events), two properties — Skyline Serenity (near Kolkata airport) and Monurama Homestay (Mukundapur, EM Bypass). Public site: bookmyspaces.in.

## Who uses it

- **Operators** (sales/reservations staff) — the primary daily users, working leads, proposals, reservations, and conversations across channels.
- **The business owner** — dashboards, revenue intelligence, and (per the growth-platform plan) marketing/campaign oversight.
- **Guests** — indirectly, via WhatsApp, website chat, (planned) social DMs, and read-only proposal share links. Guests do not have accounts or a self-service portal today — every guest-facing interaction is either a conversational channel or an operator-mediated document (proposal, invoice). This is a deliberate, current-state fact, not a gap to silently close — see `MASTER_ROADMAP.md` if self-service booking is ever prioritized.

## Core product modules (current, per repository state)

| Module | What it does | Status |
|---|---|---|
| Leads & Kanban | Lead capture, scoring, pipeline stages, follow-ups | Live |
| Proposals | Builder, PDF, share link, view tracking, intelligence | Live |
| Invoicing & Payments | Invoice generation, payment recording, refunds | Live |
| Reservations | Availability, pricing, booking workflow, calendar | Built (service + UI); DB migration apply status must be verified live before relying on it — see `MASTER_DATABASE.md` |
| Catalog admin | Properties, rooms/venues, rate plans, meal plans, add-ons, packages | Live |
| AI chat (website + WhatsApp) | Grounded Q&A, lead extraction, qualification | Live |
| WhatsApp | Deterministic state-machine conversations + campaigns | Live |
| Unified conversations | One timeline across channels | Built, cutover incomplete (dual-write, legacy tables not retired) |
| Social | Unified inbox schema, Meta adapter, content studio | Schema live; publishing pipeline incomplete |
| Dashboards | Operations, revenue, stats, intelligence | Live |
| Growth platform (marketing automation, referral, loyalty, review mgmt) | See `docs/growth/` | Designed, not built |

## Product principles (durable — do not revisit lightly)

These are restated from existing docs because they are the product's actual constitution, and an Engineering OS exists to keep them from eroding as different people touch the codebase over years:

1. **Extend, never rebuild.** Reuse before writing new code. No duplicate implementations of the same concept.
2. **CRM (Supabase Postgres) is the single system of record** — no shadow state in a separate service, cache, or spreadsheet becomes authoritative.
3. **One customer, one timeline**, regardless of channel.
4. **Additive-only migrations.** No renames, drops, or type-narrowing without explicit, recorded approval.
5. **Human approval before any customer-facing send or destructive/irreversible action.** AI drafts; humans send. This is a safety commitment to guests, not just an engineering convenience.
6. **Every integration is an adapter.** Adding a channel/platform never changes CRM core.
7. **Every phase/release ends deployable**: build, typecheck, lint, tests green, docs updated.

## What "done" means for this product

Not a checklist that's ever fully checked off — a hospitality CRM's job never ends — but the recurring definition of done, applied at every phase per `MASTER_ROADMAP.md`:

- The feature reuses an existing module/table/service wherever one exists (verified by reading `MASTER_ARCHITECTURE.md`/`MASTER_DATABASE.md` first, not assumed).
- It degrades gracefully if a dependency (a migration, an external API credential) isn't yet live, following the established convention (`DEFAULT_SETTINGS`-style fallbacks) rather than crashing.
- It's covered by the auth/validation/logging conventions in `MASTER_CODING_STANDARDS.md`.
- It's documented in the relevant MASTER file and, if customer-facing or risk-bearing, in a release note under `docs/releases/`.

## Explicitly out of scope for this Engineering OS (record, don't guess)

- **Multi-tenant SaaS.** No part of this product's data model, auth, or billing assumes more than one operator organization. Assumed out of scope for the 3–5 year horizon unless the business explicitly decides otherwise.
- **OTA channel management** (Booking.com/Agoda/Expedia sync) — named in the existing root `IMPLEMENTATION_ROADMAP.md` as Phase 7, real future scope, but not designed in this OS pass; flagged in `MASTER_ROADMAP.md` as a known future phase, not designed here.
- **Housekeeping/maintenance operations** — same status as OTA channel management: named, not designed.
- **A public self-service booking engine** — today's booking intake is conversational/operator-mediated by design (see `WORKFLOW_VERIFICATION.md`'s finding that proposal acceptance is deliberately operator-mediated, not a gap). This OS does not assume self-service booking is coming; if the business decides it should, that's a new product decision requiring its own spec, not an extension silently bolted onto `MASTER_DATABASE.md`'s `reservations` model.
