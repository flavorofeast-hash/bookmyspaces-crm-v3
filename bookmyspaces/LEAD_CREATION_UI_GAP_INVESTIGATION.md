# Investigation: No Lead/Customer Creation Entry Point on `/customers`

**Date:** 2026-08-02
**Mode:** Investigation only. No code changed. No commits.
**Trigger:** Manual RC2 UI validation — `/customers` loads correctly but has no "New Customer"/"New Lead" button, blocking the Lead → Proposal → Reservation → Invoice workflow's first step.

---

## Root cause

**There is no single-lead "Add Lead"/"New Lead" form or button anywhere in the CRM UI — not just on `/customers`.** This is not specific to the Customers page; it's an app-wide gap. `POST /api/leads` (the backend that would power such a form) is fully built, validated, and wired into the same automation chain as every other lead-creation path — but zero pages call it. Grepped the entire `src` tree for `Add Lead`, `New Lead`, `Create Lead`, `LeadForm`, `CustomerForm`, and any client-side `fetch('/api/leads', { method: 'POST' })` call: no matches outside test files and the API route itself.

This finding is not new — it was already documented on 2026-07-27 in `SMOKE_TEST_VALIDATION.md` (Go-Live Prep, Phase 5, "Flow 4: Manual Lead"), independently re-confirmed today via a fresh search rather than taken on trust: *"there is no single-lead 'Add Lead' button or form anywhere in the CRM UI ... This is a real, user-facing gap worth a product decision ... flagged here rather than fixed, since the Go-Live directive's scope is verification, not new functionality."* That prior finding was correct and remains current on `release/v1.0.0-rc2` today.

**A second, distinct issue was found this session:** the one CRM screen that *does* list and manage leads in bulk — `/dashboard/leads` (Lead Management: search/sort/paginate + link to Import) — is fully built but **not linked from the main sidebar navigation at all** (`src/components/layout/CRMLayout.tsx`'s nav array has no entry for it). It's reachable only by typing the URL directly. This compounds the problem: even the closest thing to a "browse and manage all leads" screen is effectively invisible to a staff member using the app normally.

---

## Answers to the specific investigation questions

**1. Is this intentional?**
Partially, and only for one narrow piece. `/customers` (`src/app/(crm)/customers/page.tsx`) is **intentionally search-only by design** — its own header comment states it was built for "V3 Sprint 3 — Priority 5 / Definition of Success: 'search customer'," as "a dedicated search entry point into the Customer Profile screen ... which previously had no way to reach it other than a direct URL." It was never scoped to include creation. So: the *search-only* nature of `/customers` specifically is intentional. But the **broader absence of any manual lead-creation UI anywhere in the app is not intentional** — it's a documented, known gap (see `SMOKE_TEST_VALIDATION.md` above), not a deliberate product decision to omit the feature entirely.

**2. Is lead creation supposed to happen somewhere else?**
Yes — by design, the overwhelming majority of leads are meant to be created **automatically**, not typed in by staff:
- Website chat widget → `POST /api/chat` → `upsertLead()`, `source: 'website'`
- WhatsApp inbound message → webhook → `processInboundMessage()` → identity resolution/lead creation
- Campaign landing pages (`/wedding`, `/birthday`, etc.) → `POST /api/campaigns/track` → direct `leads` insert (depends on migration 026, separately confirmed live 2026-08-02)
- Facebook/Instagram Lead Ads or DM → social webhook → `captureLeadWithJourney()` / `captureSocialDirectMessage()` (currently inactive — Social env vars unset — but wired)
- Bulk CSV/Excel upload → `/dashboard/leads/import` → `POST /api/leads/import`

One additional path functions as an *implicit* manual-entry mechanism, though it isn't framed as one: **`/visits/new` ("Schedule Visit," linked in the main nav) auto-creates a lead as a side effect if the name/phone/email entered doesn't match an existing customer** (`scheduleSiteVisit()` in `src/lib/visits/site-visit-service.ts`, lines 58–89 — resolves an existing lead by phone/email via `resolveIdentity()`, and only if none is found does it `insert` a new `leads` row with `source: 'other'`). This is the only currently-linked, currently-working UI path that can produce a brand-new customer record from a blank form today — but it requires scheduling a visit to do it, and doesn't work for a walk-in who isn't there for a site visit (e.g., a phone enquiry the staff wants to log immediately).

**3–5. Search results / every page and API that can create a lead**

Pages (App Router, under `src/app`):

| Route | File | Can create a lead? |
|---|---|---|
| `/customers` | `(crm)/customers/page.tsx` | No — search only, by design |
| `/customers/[id]` | `(crm)/customers/[id]/page.tsx` | No — profile view of an existing lead only |
| `/dashboard/leads` | `(crm)/dashboard/leads/page.tsx` | No — list/search/sort only ("Refresh" and "Import" are its only two buttons; no "New Lead") |
| `/dashboard/leads/[id]` | `(crm)/dashboard/leads/[id]/page.tsx` | No — detail view of an existing lead |
| `/dashboard/leads/import` | `(crm)/dashboard/leads/import/page.tsx` | **Yes — bulk only** (CSV/Excel upload → `POST /api/leads/import`) |
| `/kanban` | `(crm)/kanban/page.tsx` | No — pipeline board for existing leads; has a "+ New Proposal" button but no add-lead affordance |
| `/visits/new` | `(crm)/visits/new/page.tsx` | **Yes — implicitly**, as a side effect of scheduling a visit (see above) |
| `/proposals/new` | `(crm)/proposals/new/page.tsx` | No — requires an existing `lead_id` passed via query param; cannot originate a lead |
| `/dashboard`, `/dashboard/founder`, `/dashboard/marketing`, `/dashboard/revenue`, `/dashboard/intelligence`, `/dashboard/operations`, `/dashboard/chief-of-staff` | various | No — all read-only analytics/ops views (checked `HotLeadDashboard.tsx`, the widget on the main `/dashboard`, specifically — status filter buttons and a refresh button only) |
| `/inbox` | `(crm)/inbox/page.tsx` | No — conversation view over existing identities |

API endpoints (under `src/app/api`) that insert into `leads`:

| Endpoint | File | Trigger |
|---|---|---|
| `POST /api/leads` | `api/leads/route.ts` | Single-record creation, fully built, validated (`createLeadSchema`), wired to identity resolution/AI qualification/package recommendation/welcome message — **but called by no page in the UI** |
| `POST /api/leads/import` | `api/leads/import/route.ts` | Bulk CSV/Excel, called by `/dashboard/leads/import` |
| `POST /api/chat` | `api/chat/route.ts` | Website chat widget (automated) |
| `POST /api/campaigns/track` | `api/campaigns/track/route.ts` | Campaign landing page auto-capture (automated) |
| WhatsApp webhook | `api/whatsapp/webhook/route.ts` (→ `processInboundMessage()`) | Inbound WhatsApp message (automated) |
| Social webhook | `api/social/webhook/[platform]/route.ts` (→ `dm-capture-service.ts`) | Inbound Facebook/Instagram DM or Lead Ad (automated, currently inactive) |
| Site visit scheduling | `api/site-visits/route.ts` (→ `scheduleSiteVisit()`) | `/visits/new` form, only when no existing lead matches (implicit manual entry) |

**6. Is the Customers page intentionally search-only, incomplete, missing a button, feature-flagged, hidden by permissions, or broken by navigation?**
**Intentionally search-only** — confirmed by its own file header (see Q1). It is **not** feature-flagged (no flag check anywhere in the file), **not** permission-gated beyond the same `requireAuth()` every other CRM page uses, and **not** broken navigation in the sense of a dead/misrouted link — there is simply no button there to begin with, by original design. Calling it "incomplete" is fair in the sense that the *product* (the four-stage Lead → Proposal → Reservation → Invoice workflow) has no working first step through the UI at all — but that incompleteness lives at the app level, not as a defect specific to this one page.

**7. Intended user journey for creating a lead**
As designed: leads arrive automatically (website chat, WhatsApp, campaign landing pages, social) or via bulk import; staff then work leads through `/kanban` (or, if they knew to navigate there directly, `/dashboard/leads`) into proposals and reservations. **There is no intended journey in the current build for a staff member to manually key in one new lead from a phone call or walk-in enquiry** — that step is missing end-to-end, not just missing a button on one page. `/visits/new` incidentally covers the "walk-in who wants a site visit" case, but not "log this phone enquiry" in general.

**8. Routes under `src/app` relating to leads / customers / crm** (complete list, cross-referenced against the sidebar nav in `CRMLayout.tsx`):

- `src/app/(crm)/customers/page.tsx` → `/customers` — **linked in nav**
- `src/app/(crm)/customers/[id]/page.tsx` → `/customers/:id` — reachable via search results
- `src/app/(crm)/dashboard/leads/page.tsx` → `/dashboard/leads` — **NOT linked in nav** (orphaned)
- `src/app/(crm)/dashboard/leads/[id]/page.tsx` → `/dashboard/leads/:id` — reachable only from the above
- `src/app/(crm)/dashboard/leads/import/page.tsx` → `/dashboard/leads/import` — **NOT linked in nav**, reachable only via the leads list page's "Import" button, which is itself unreachable through the nav
- `src/app/(crm)/kanban/page.tsx` → `/kanban` — **linked in nav**
- `src/app/(crm)/visits/new/page.tsx` → `/visits/new` — **linked in nav** ("Schedule Visit")
- `src/app/(crm)/dashboard/page.tsx` → `/dashboard` — **linked in nav**
- `src/app/(crm)/proposals/new/page.tsx`, `proposals/page.tsx` → `/proposals`, `/proposals/new` — **linked in nav** (list only; "new" requires an existing lead)
- `src/app/(crm)/inbox/page.tsx` → `/inbox` — **linked in nav**
- All `src/app/api/leads*` and `src/app/api/customers*` routes — backend only, not pages

**9. Is there a Lead page that simply isn't linked?**
**Yes — `/dashboard/leads` (and by extension `/dashboard/leads/import` and `/dashboard/leads/[id]`).** Grepped the entire `src` tree for the string `dashboard/leads`: every reference to it is an internal link *within* that same page cluster (the detail page links back to the list; the import page redirects to the list after a successful upload). Nothing in `CRMLayout.tsx`'s nav, `/dashboard`, `HotLeadDashboard.tsx`, `/customers`, or `/kanban` links to it. A user who doesn't already know the URL has no way to discover this page exists.

**10. Smallest possible fix (not implemented — recommendation only)**

Two separable, independently-shippable fixes, in order of leverage:

1. **Add `/dashboard/leads` to the sidebar nav** (`src/components/layout/CRMLayout.tsx`'s nav array — one new `{ href: '/dashboard/leads', label: 'Leads' }` entry). This alone makes the existing, fully-working Lead Management + Import screens reachable, restoring at least the bulk-import path as a discoverable manual entry point. Trivial, zero backend risk — the page and its API already work; this is purely a missing link.
2. **Add a "New Lead" button + a small modal/form to one CRM screen** (most natural: `/dashboard/leads`, next to its existing "Import" button, or alternatively `/customers`) that posts `name`/`phone`/`email`/`event_type`/`guest_count`/`budget`/`notes` to the already-built, already-validated `POST /api/leads`. No backend work is needed — `createLeadSchema` (`src/lib/validation.ts`) and the full automation chain (identity resolution, duplicate-by-phone handling, AI qualification, package recommendation, welcome message) are already live and already exercised by every other lead-creation path. This is a small, additive UI change (one new client component + one button + one API call to an existing, working endpoint), not a new capability.

Fix 1 is smaller and lower-risk (pure navigation, no new UI logic); Fix 2 is what actually unblocks the "type in a new lead by hand" workflow the operator hit. Both are additive, don't touch any existing working path, and carry effectively zero regression risk to the automated lead-creation flows (website/WhatsApp/social/campaign) since those don't go through whatever new form gets built.

---

## Affected files (for reference — none modified)

- `src/app/(crm)/customers/page.tsx` — confirmed intentionally search-only
- `src/app/(crm)/dashboard/leads/page.tsx` — Lead Management list, fully built, unlinked from nav, no create button
- `src/app/(crm)/dashboard/leads/[id]/page.tsx` — Lead detail, reachable only from the list above
- `src/app/(crm)/dashboard/leads/import/page.tsx` — bulk CSV/Excel import, the only working UI-driven creation path today
- `src/app/(crm)/kanban/page.tsx` — pipeline board, has proposal creation but no lead creation
- `src/app/(crm)/visits/new/page.tsx` + `src/lib/visits/site-visit-service.ts` — implicit lead-creation side effect of scheduling a visit
- `src/app/(crm)/proposals/new/page.tsx` — requires an existing `lead_id`, cannot originate one
- `src/components/layout/CRMLayout.tsx` — sidebar nav array; missing entry for `/dashboard/leads`
- `src/app/api/leads/route.ts` — `POST /api/leads`, fully built and unused by any page
- `SMOKE_TEST_VALIDATION.md` — prior-session documentation of the same core gap (2026-07-27), independently re-confirmed today

No files were changed. No commits were made.
