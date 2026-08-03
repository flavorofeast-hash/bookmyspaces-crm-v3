# Lead Workspace — Design Plan (Pre-Implementation)

Status: **Planning only. No code written.**
Builds on `LEAD_WORKSPACE_AUDIT.md` (prior audit). This document goes one level deeper — full component/hook/utility inventory, a per-widget reuse matrix, a wireframe, a dependency map, risks, and a phased plan — per the "Build the Lead Workspace" mission brief.

Ground rules honored throughout: no redesign, no duplicate functionality, reuse existing APIs/components/pages, schema unchanged, no breaking changes.

---

## SECTION 1 — Existing Components That Can Be Reused

Important architectural note before the list: **there is no shared CRM component library.** `src/components/` only holds `auth/UserMenu.tsx`, `layout/CRMShell.tsx`, `layout/CRMLayout.tsx`, `chatbot/ChatWidget.tsx`, and marketing-site `landing/*` components. Every domain widget below (Timeline, AI Assistant, Proposal list, Action buttons, Kanban side panel) is written **inline inside a page file**, not exported as an importable component. "Reuse" therefore means one of two things per widget: import it if it happens to already be a standalone function/component, or extract-then-import if it's currently inline (see Section 6 and the Dependency Map for which is which).

| Component / Block | Where it lives today | Exported/importable? | Notes |
|---|---|---|---|
| `AIAssistantPanel` (8 AI actions + Event Sales Advisor) | `src/app/(crm)/customers/[id]/page.tsx` (bottom of file) | No — local function in the page module | Self-contained, takes only `customerId` prop. Easiest true "drop-in" once extracted. |
| Timeline list rendering (icon-by-type, chronological feed) | `src/app/(crm)/customers/[id]/page.tsx` (`TIMELINE_ICON` map + `<ol>` block) | No — inline JSX | Reads `CustomerTimeline` shape from `GET /api/customers/[id]/timeline`. |
| Proposals-for-lead list card | `src/app/(crm)/customers/[id]/page.tsx` (Proposals panel) | No — inline JSX | Reads `GET /api/proposals?lead_id=`. |
| Opportunity Score badge + breakdown | `src/app/(crm)/customers/[id]/page.tsx` (header) | No — inline JSX | Reads `opportunityScore` from `GET /api/customers/[id]` response. |
| Lifetime Value strip | `src/app/(crm)/customers/[id]/page.tsx` (header) | No — inline JSX | Reads `lifetimeValue` from same response. |
| Kanban lead detail side panel (WhatsApp link, Create Proposal link, stage quick-move buttons, follow-up scheduler, note composer, AI "Analyse" summary, activities/proposals sub-panels) | `src/app/(crm)/kanban/page.tsx` | No — inline JSX inside `KanbanPage` | See Section 6 — the Activity Timeline and Proposals sub-panels inside this exact panel are currently **dead** (never populated; see finding below). Stage quick-move + WhatsApp link + follow-up scheduler + note composer + AI summary ARE live and working. |
| `LeadCard` (kanban board card: score, follow-up badge, proposal-sent badge) | `src/app/(crm)/kanban/page.tsx` (bottom of file) | No — local function, but file-scoped only | Not needed for Lead Workspace directly (it's a board-card, not a detail view), listed for completeness. |
| Reservation Detail screen (status actions: Confirm/Cancel/Check-in/Check-out, linked customer Timeline) | `src/app/(crm)/reservations/[id]/page.tsx` | No — whole page, not a component | Good model to copy the *pattern* from (it already embeds a customer Timeline next to a booking) but not directly importable into a lead workspace tab. |
| Site Visit scheduling form (`Section`/`Label`/`Input`/`SelectField` primitives) | `src/app/(crm)/visits/new/page.tsx` | No — local functions, redeclared per-page | Same primitives (`Section`, `Label`, `Input`) are redeclared near-identically in `proposals/new/page.tsx` too — duplicated styling code, not shared UI atoms. |
| `CRMShell` / `CRMLayout` (page chrome: nav, sidebar) | `src/components/layout/CRMShell.tsx`, `CRMLayout.tsx` | Yes — real shared components | Already used by every `(crm)` page including Lead Details; no change needed. |
| `UserMenu` | `src/components/auth/UserMenu.tsx` | Yes | Chrome-level, not lead-specific. |
| `ChatWidget` | `src/components/chatbot/ChatWidget.tsx` | Yes | Customer-facing chat widget, not an operator tool — not relevant to this workspace. |
| Documents (file attachments) | — | **Does not exist as a lead-facing feature.** `documents` table (migration 001) + `src/lib/documents.ts` back the AI knowledge-base uploader only (PDF/DOCX → chunked embeddings for the chatbot), not per-lead file attachments/contracts. | Real gap if "Documents" means "files attached to this lead." |
| Tasks | — | **Does not exist anywhere in the codebase.** No `tasks` table, no task API, no task UI. Grepped `\btasks\b` across `src/` — zero matches. | Real gap, or map "Tasks" onto the existing Follow-ups system if that's what was actually meant. |
| Notes | YES, but minimal | `leads.notes` (single TEXT column) appended to via `POST /api/followups {action:'note'}` | Not a discrete notes table/list — every note is concatenated into one timestamped text blob. Works, but isn't a "notes feed" of individual entries. |
| Revenue (per-lead) | YES | `src/lib/customers/lifetime-value.ts`, shown in Customer Profile header | Aggregate revenue dashboard is separate: `src/app/(crm)/dashboard/revenue/page.tsx` (not per-lead, out of scope). |
| Lead Score | YES | `ai_score`/`lead_temperature`/`score_breakdown` columns; `src/lib/lead-scorer.ts`, `src/lib/scoring.ts`; rendered in both Kanban card and Customer Profile header (as Opportunity Score) | Two overlapping scoring concepts exist — see Risk Analysis. |

## SECTION 2 — Existing API Routes (full inventory relevant to a lead workspace)

Lead core:
- `GET/POST/PATCH /api/leads` — list/create/update
- `GET /api/leads/hot` — hot leads list
- `GET/POST /api/leads/summary` — **bundled** lead+conversations+activities+proposals fetch (GET), AI summary generation (POST)
- `PATCH /api/leads/[id]/stage` — validated stage transition (covers Change Stage, Mark Won, Mark Lost)
- `POST /api/leads/[id]/follow-up-email` — templated follow-up email
- `POST /api/leads/import` — bulk import (not workspace-relevant)

Customer/timeline:
- `GET /api/customers/[id]` — full lead record + `lifetimeValue` + `opportunityScore`
- `GET /api/customers/[id]/timeline` — unified cross-source timeline
- `POST /api/customers/[id]/ai` — AI Operator Assistant (8 actions + Event Sales Advisor)

Proposals:
- `GET/POST /api/proposals` (supports `?lead_id=`, `?status=`, `?id=`)
- `GET /api/proposals/[id]/preview`, `/pdf`, `/receipt`, `/booking-confirmation`
- `POST /api/proposals/[id]/invoice`, `/invoice/email`, `/payment`, `/payment-reminder`
- `POST /api/proposals/email`
- `GET /api/proposals/track-view`, `GET /api/proposals/intelligence`
- `GET/POST /api/proposal/share/[token]`

Site visits:
- `GET/POST /api/site-visits` (GET by date, POST to schedule)
- `GET/PATCH /api/site-visits/[id]`

Reservations:
- `GET/POST /api/reservations`
- `GET/PATCH /api/reservations/[id]`
- `POST /api/reservations/[id]/status` (confirm/cancel/check_in/check_out)
- `POST /api/reservations/[id]/proposal`
- `GET /api/reservations/availability`, `POST /api/reservations/block`

Follow-ups:
- `GET/POST /api/followups` (`action`: schedule/note/complete/single/bulk; `?lead_id=` for per-lead activity list)
- `GET /api/cron/followups`, `GET /api/cron/escalations` (automated, not user-triggered)

WhatsApp:
- `GET /api/conversations`
- `POST /api/whatsapp/send` (manual/template send)
- `POST /api/whatsapp/webhook` (inbound, automatic)
- `GET/POST /api/inbox`, `GET/POST /api/inbox/[id]`, `POST /api/inbox/[id]/reply`, `POST /api/inbox/[id]/ai`

Email:
- `POST /api/proposals/email`, `/proposals/[id]/invoice/email`, `/proposals/[id]/payment-reminder`
- No generic freeform compose endpoint exists.

Analytics/scoring:
- `POST /api/analytics` (`action:'score_leads'` — bulk AI scoring)
- `GET /api/dashboard/stats`, `/revenue`, `/operations`, `/intelligence` (aggregate, not per-lead)

## SECTION 3 — Existing Services

- `src/modules/leads/lead-stage-manager.ts` — `transitionStage()`, `canTransition()`, `autoAdvanceStage()`, `isStale()`
- `src/modules/leads/types.ts` — `LEAD_STAGES`, `VALID_TRANSITIONS`, `STAGE_PIPELINE`, `effectiveStage()` (single source of truth for stage display/logic)
- `src/lib/timeline/timeline-service.ts` — `getCustomerTimeline()`
- `src/lib/customers/lifetime-value.ts` — lifetime value calc
- `src/lib/ai/opportunity-score.ts` — opportunity score calc
- `src/lib/ai/operator-assistant.ts` — 8 AI actions + Event Sales Advisor
- `src/lib/ai/context-builder.ts` — shared AI context assembly (used by operator-assistant and others)
- `src/lib/visits/site-visit-service.ts` — `scheduleSiteVisit()`, `listSiteVisitsForDate()`, `updateSiteVisitStatus()`, `leadHasScheduledVisit()`
- `src/lib/reservations/reservation-service.ts`, `reservation-workflow.ts` — CRUD + state machine (confirm/cancel/check-in/check-out)
- `src/lib/proposals/proposal-service.ts` — `ensureLeadForProposal()` and proposal CRUD helpers
- `src/lib/email/send.ts`, `templates.ts`, `provider.ts` — templated email send + logging
- `src/lib/whatsapp/send-message.ts`, `conversation-manager.ts`, `verify-signature.ts` — WhatsApp send/receive
- `src/lib/whatsapp/auto-qualify.ts` — `qualifyLeadFromMessage()`
- `src/lib/leads/auto-package-recommendation.ts` — `runAutoPackageRecommendation()`
- `src/lib/lead-scorer.ts`, `src/lib/scoring.ts` — scoring + `generateProposalCoverNote()`
- `src/modules/followups/followup-engine.ts`, `followup-rules.ts` — automated follow-up logic (cron-driven)
- `src/modules/automation/escalation-engine.ts` — escalation logic (cron-driven)
- `src/lib/identity/resolve-identity.ts` — dedupe leads by phone/email
- `src/lib/auth-guard.ts` — `requireAuth()` used by every route above

## SECTION 4 — Existing Hooks

**None exist.** There is no `src/hooks/` directory anywhere in the project, and a project-wide search for exported `use*` functions found nothing CRM-related. Every page (Customer Profile, Kanban, Reservation Detail, Visit form) does its own `useState`/`useEffect`/`fetch` inline — there is no `useLead()`, `useTimeline()`, `useProposals()`, or similar shared data hook to reuse. This is a real absence, not a hidden asset.

## SECTION 5 — Existing Utilities

- `src/lib/logger.ts` — `logger.info/warn/error`, used everywhere
- `src/lib/supabase.ts`, `supabase-admin` — DB client
- `src/lib/validation.ts` — Zod schemas + `parseBody()` (`leadStageBodySchema`, `updateLeadSchema`, `createLeadSchema`, `reservationStatusActionSchema`, etc.)
- `src/lib/rate-limit.ts` — rate limiting
- `src/lib/audit-log.ts` — admin audit logging
- `src/lib/tax.ts` — tax calc (proposal/invoice)
- Formatting helpers — **not centralized.** `fmtINR()`, `fmtDate()`, `fmtDateTime()` are redeclared nearly identically in both `dashboard/leads/[id]/page.tsx` and `customers/[id]/page.tsx` (and similar date formatting appears again in `kanban/page.tsx` using `date-fns`). No shared `src/lib/format.ts` exists.
- `Section`/`Label`/`Input`/`SelectField` form primitives — redeclared per-page (`visits/new`, `proposals/new`), not a shared UI kit.

## SECTION 6 — Implemented But Not Currently Visible / Not Fully Wired

1. **Everything listed in `LEAD_WORKSPACE_AUDIT.md`** — Timeline, Proposals list, AI Assistant, Lifetime Value, Opportunity Score are all live on `/customers/[id]` only, invisible from `/dashboard/leads/[id]`.
2. **Kanban's own Activity Timeline and Proposals sub-panels are dead code.** `KanbanPage` declares `leadContext` state (`activities`, `proposals`, `summary`) and renders both an "Activity Timeline" and "Proposals" block conditioned on it — but the only place `setLeadContext` is ever called is inside the "Analyse" AI-summary button handler, which sets `summary` alone (`setLeadContext(prev => ({...(prev||{activities:[],proposals:[]}), summary: d.summary}))`). Nothing ever fetches or sets `activities`/`proposals`, so those two panels never render in production today, even though `GET /api/leads/summary?lead_id=` (already built, unused by the UI) returns exactly the `activities` and `proposals` arrays they need. This is a one-line wiring fix, and a good candidate to fix opportunistically while building the Lead Workspace (either by reusing that GET route directly, or superseding it with the richer `getCustomerTimeline()`).
3. **Assign Owner** — `leads.assigned_to` column and API support exist; no UI control anywhere sets it.
4. **`generateProposalCoverNote()`** (AI proposal drafting) runs automatically after qualification; there's no manual "Draft Proposal" trigger button anywhere.
5. **Manual re-run of lead qualification** — `qualifyLeadFromMessage()` only runs at creation time; no "Re-qualify" action exists.

---

## Reuse Matrix (Third Task)

Per proposed Lead Workspace widget/section:

| Widget | Existing Component | Existing API | Existing Service | Existing DB Table(s) | Reusable as-is? | Adapter needed? | New code unavoidable? |
|---|---|---|---|---|---|---|---|
| Header (name/phone/email/stage/score/revenue) | Inline in `customers/[id]/page.tsx` header block | `GET /api/customers/[id]` | `lifetime-value.ts`, `opportunity-score.ts` | `leads` | No (inline) | **Yes** — extract into `<LeadHeader>` | No |
| Owner field in header | — | `PATCH /api/leads` (accepts `assigned_to`) | — | `leads.assigned_to` | No UI exists | — | **Yes** — new `<AssignOwnerControl>` (small: dropdown + one PATCH call) |
| Tab: Overview | Fields already shown in `dashboard/leads/[id]/page.tsx` (current viewer) | `GET /api/customers/[id]` | — | `leads` | Yes, current page content becomes this tab almost unchanged | No | No |
| Tab: Timeline | Inline `<ol>` block in `customers/[id]/page.tsx` | `GET /api/customers/[id]/timeline` | `timeline-service.ts` | `conversations`, `whatsapp_messages`, `email_log`, `activity_logs`, `proposals`, `invoices`, `reservations`, `ai_interaction_log` | No (inline) | **Yes** — extract into `<LeadTimeline>` | No |
| Tab: Proposals | Inline list in `customers/[id]/page.tsx` | `GET /api/proposals?lead_id=` | `proposal-service.ts` | `proposals` | No (inline) | **Yes** — extract into `<LeadProposals>`, add "New"/"PDF"/"Share" action links | No |
| Tab: Site Visits | None (no per-lead visit list UI exists anywhere) | `GET /api/site-visits?date=` (date-scoped, **not** lead-scoped) | `site-visit-service.ts` (`listSiteVisitsForDate` — needs a lead-scoped variant) | `follow_ups` (`type='site_visit'`) | No | **Yes** — small service addition: `listSiteVisitsForLead(leadId)` alongside the existing date-scoped function; thin new list component | Minimal (one new query function, reusing the same table/mapping logic) |
| Tab: Reservations | Reservation Detail page pattern (`reservations/[id]/page.tsx`) | `GET /api/reservations` (needs `?lead_id=`/`?customer_id=` filter — not confirmed present) | `reservation-service.ts` | `reservations` | No | **Yes** — verify/add a lead-scoped filter on the existing GET, then a thin list component | Small, only if the filter is missing (verify before building) |
| Tab: Follow Ups | Kanban's follow-up scheduler + note composer (inline) | `GET/POST /api/followups?lead_id=` | — | `follow_ups`, `activity_logs` | No (inline) | **Yes** — extract into `<LeadFollowUps>` | No |
| Tab: AI Assistant | `AIAssistantPanel` in `customers/[id]/page.tsx` | `POST /api/customers/[id]/ai` | `operator-assistant.ts`, `context-builder.ts` | reads from AI context, no direct table | **Yes, near-verbatim** — already takes just a `customerId` prop | Extract to shared file, no logic change | No |
| Tab: Documents | — | — | `src/lib/documents.ts` (wrong domain — knowledge base, not lead files) | `documents` (wrong domain) | No | No | **Yes — real gap.** Needs new table (or reuse `documents` table by adding a `lead_id` FK if schema changes are acceptable) + upload API + list UI. Flag for stakeholder decision — may be descoped. |
| Tab: Notes | Kanban's note composer (inline, appends to `leads.notes`) | `POST /api/followups {action:'note'}` | — | `leads.notes` (single text column) | Partially | **Yes** — extract composer into `<LeadNotes>`; note it renders one growing text blob, not discrete entries (acceptable if that matches current behavior elsewhere) | No |
| Tab: Activity | Kanban's Activity Timeline block (currently dead, see Section 6.2) | `GET /api/followups?lead_id=` (activity-only) or `getCustomerTimeline()` (fuller) | `timeline-service.ts` | `activity_logs` | No (inline, and currently unwired in Kanban) | **Yes** — prefer wiring to `getCustomerTimeline()` (already built and correct) rather than fixing Kanban's dead path | No |
| Sidebar: Call | — | — | — | `leads.phone` | N/A | `tel:` link, no API | No (trivial `<a href="tel:">`) |
| Sidebar: WhatsApp | Kanban's `wa.me` link (inline) | `POST /api/whatsapp/send` (if templated send preferred over deep-link) | — | `leads.phone` | Yes, copy the one-line pattern | No | No |
| Sidebar: Create Proposal | Kanban's `proposalHref()` builder (inline) | Links to `/proposals/new?lead_id=...` | `proposal-service.ts` | `proposals` | Yes, copy the link-builder | No | No |
| Sidebar: Schedule Visit | — | Links to `/visits/new?lead_id=...` (page already accepts prefill params) | `site-visit-service.ts` | `follow_ups` | Yes | No | No |
| Sidebar: Book Reservation | — | Links to `/reservations` new-booking flow (verify a lead-prefill param exists; may need adding) | `reservation-service.ts` | `reservations` | Mostly | Possibly small — add `?lead_id=` prefill support if missing | Minimal, verify first |
| Sidebar: Assign Owner | — | `PATCH /api/leads` | — | `leads.assigned_to` | No | New control | **Yes** (same item as header owner field — one control, used in both places) |
| Sidebar: AI Summary | Kanban's "Analyse" button (inline) | `POST /api/leads/summary` or `POST /api/customers/[id]/ai {action:'customer_summary'}` | `operator-assistant.ts` | — | Yes — prefer the `customer_summary` AI Operator Assistant action for consistency with the AI tab rather than the separate `/api/leads/summary` path | Choose one, don't wire both | No |
| Bottom: Recent Activities | Same data source as Tab: Activity / Tab: Timeline | `getCustomerTimeline()` | `timeline-service.ts` | as above | Yes — literally the same component, just sliced to N most-recent and rendered outside the tab strip | No | No |

**Summary of the Reuse Matrix:** of the ~20 widgets, the large majority need only extraction (moving inline JSX into an importable component with zero logic change) or a thin link/button — not new logic. Three items need small, additive new code: Assign Owner control, a lead-scoped Site Visits query, and confirming/adding a lead-scoped Reservations filter. One item — Documents — is a genuine feature gap requiring a product decision before any code is written.

---

## Workspace Wireframe (Second Task)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Back to Leads                                                          │
│                                                                            │
│  [Name]                                            [Opportunity: 72/100] │
│  📞 Phone  ✉ Email  📅 Since date          [Temperature] [Stage badge]   │
│  Owner: [dropdown ▾]        Est. Revenue: ₹XX,XXX    LTV: ₹XX,XXX        │
└──────────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────┬──────────────────────┐
│ [Overview] [Timeline] [Proposals] [Site Visits]    │  QUICK ACTIONS       │
│ [Reservations] [Follow Ups] [AI Assistant]         │  ─────────────────   │
│ [Notes] [Activity]  ([Documents] — pending scope)  │  📞 Call             │
│                                                     │  💬 WhatsApp         │
│  ┌───────────────────────────────────────────────┐│  📄 Create Proposal  │
│  │                                                 ││  🏠 Schedule Visit   │
│  │         (active tab content renders here,       ││  🛏 Book Reservation │
│  │          each tab = one existing service/API,   ││  👤 Assign Owner     │
│  │          per Reuse Matrix above)                ││  ✨ AI Summary       │
│  │                                                 ││                      │
│  └───────────────────────────────────────────────┘│                      │
└───────────────────────────────────────────────────┴──────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ RECENT ACTIVITY (last 5, from the same Timeline feed used in the tab)     │
└──────────────────────────────────────────────────────────────────────────┘
```

Notes on the wireframe vs. the brief's example:
- "Documents" tab is shown de-emphasized/pending — it's the one section with no existing backing, flagged for a scope decision rather than silently built or silently dropped.
- "Tasks" is intentionally omitted from the tab list (not in the brief's own example tab row either) since nothing in the codebase implements it; if it's wanted, it would map most naturally onto Follow Ups rather than being a new concept.
- Stage/Mark-Won/Mark-Lost are not separate buttons — per the audit, these are all the same `PATCH /api/leads/[id]/stage` call with different target stages, so the wireframe treats "Change Stage" as one control (e.g., a dropdown or the same quick-move buttons Kanban already uses) rather than three separate ones.

---

## Dependency Map (Fourth Task)

For each proposed tab/widget: Existing Component · Existing API · Existing Service · Existing DB Table(s) · Reuse status.

| # | Widget | Component | API | Service | DB Table(s) | Reuse w/o mod | Adapter req'd | New code |
|---|---|---|---|---|---|---|---|---|
| 1 | Header | inline (`customers/[id]`) | `GET /api/customers/[id]` | lifetime-value.ts, opportunity-score.ts | leads | — | ✅ extract | — |
| 2 | Overview tab | inline (`dashboard/leads/[id]`, current page) | `GET /api/customers/[id]` | — | leads | ✅ | — | — |
| 3 | Timeline tab | inline (`customers/[id]`) | `GET /api/customers/[id]/timeline` | timeline-service.ts | conversations, whatsapp_messages, email_log, activity_logs, proposals, invoices, reservations, ai_interaction_log | — | ✅ extract | — |
| 4 | Proposals tab | inline (`customers/[id]`) | `GET /api/proposals?lead_id=` | proposal-service.ts | proposals | — | ✅ extract | — |
| 5 | Site Visits tab | none | `GET /api/site-visits` (date-scoped) | site-visit-service.ts | follow_ups | — | ✅ new query fn | small |
| 6 | Reservations tab | Reservation Detail pattern | `GET /api/reservations` (verify lead filter) | reservation-service.ts | reservations | — | ✅ verify/add filter | small (conditional) |
| 7 | Follow Ups tab | inline (`kanban`) | `GET/POST /api/followups?lead_id=` | — | follow_ups, activity_logs | — | ✅ extract | — |
| 8 | AI Assistant tab | `AIAssistantPanel` (`customers/[id]`) | `POST /api/customers/[id]/ai` | operator-assistant.ts | — | — | ✅ extract, no logic change | — |
| 9 | Documents tab | none | none | none (wrong-domain table exists) | documents (wrong domain) | — | — | ✅ real gap |
| 10 | Notes tab | inline (`kanban`) | `POST /api/followups {action:'note'}` | — | leads.notes | — | ✅ extract | — |
| 11 | Activity tab / Recent Activity | Timeline component (reused, not Kanban's dead path) | `GET /api/customers/[id]/timeline` | timeline-service.ts | activity_logs (+ others) | ✅ (same as #3) | — | — |
| 12 | Sidebar: Call | none | none | — | leads.phone | ✅ (`tel:` link) | — | — |
| 13 | Sidebar: WhatsApp | inline (`kanban`) | `POST /api/whatsapp/send` (optional) | — | leads.phone | ✅ | — | — |
| 14 | Sidebar: Create Proposal | inline link-builder (`kanban`) | links to `/proposals/new` | — | — | ✅ | — | — |
| 15 | Sidebar: Schedule Visit | none | links to `/visits/new?lead_id=` | — | — | ✅ | — | — |
| 16 | Sidebar: Book Reservation | none | links to reservation flow | — | — | mostly | possibly add prefill param | minimal |
| 17 | Sidebar: Assign Owner | none | `PATCH /api/leads` | — | leads.assigned_to | — | — | ✅ small new control |
| 18 | Sidebar: AI Summary | inline (`kanban`, prefer AIAssistantPanel action instead) | `POST /api/customers/[id]/ai` | operator-assistant.ts | — | ✅ | — | — |
| 19 | Stage change / Mark Won / Mark Lost | Kanban's stage-button pattern (inline) | `PATCH /api/leads/[id]/stage` | lead-stage-manager.ts | leads, stage_transitions | — | ✅ extract | — |

**Totals:** 13 of 19 widgets are pure extraction (zero new logic). 4 need a small, additive service/API touch (site visits by lead, reservations by lead, owner control, reservation prefill link). 1 is genuinely net-new (Documents) and 1 is a documented dead-path to avoid copying (Kanban's unwired activity/proposals sub-panel — build against `timeline-service.ts` instead).

---

## Risk Analysis

- **Component extraction risk (low, but real):** Because nothing is currently exported as a shared component, "reuse" requires moving JSX out of `customers/[id]/page.tsx` and `kanban/page.tsx` into new files under something like `src/components/leads/`. Done carefully (pure extraction, same props, same render output), this is not a rewrite and both original pages continue working unchanged by importing the extracted version back. Risk is only introduced if extraction accidentally changes behavior — mitigated by doing it as a mechanical move-and-import step, verified by diffing rendered output before/after.
- **Two overlapping "lead intelligence" paths (medium):** `POST /api/leads/summary` (Kanban's AI summary, writes `leads.inquiry_summary`) and `POST /api/customers/[id]/ai {action:'customer_summary'}` (Operator Assistant, no persisted write) do similar but not identical things. Wiring both into the new workspace would be confusing and borderline "duplicate functionality" against rule #2. Recommendation: standardize on the Operator Assistant action for the workspace's AI Summary, leave Kanban's existing button untouched (out of scope to change Kanban), and don't re-invent a third path.
- **Reservation migration status (medium):** Per the prior audit, migration 012 (`reservations` table) was last confirmed **not applied** in at least one environment. The Reservations tab must handle the same graceful-degradation pattern `timeline-service.ts` already uses (`degraded: true`, no error) rather than assuming the table is populated. Verify live migration status before Phase 2 (see below) rather than discovering it in production.
- **Two scoring concepts coexist (low-medium):** `ai_score`/`lead_temperature` (Kanban's "AI Score", 0–10-ish, used for board sorting) and `opportunityScore` (Customer Profile's 0–100 "Opportunity Score", multi-component breakdown) are computed differently and shown differently. The workspace header should pick one primary score to avoid confusing the sales team with two different-looking numbers that don't obviously relate — this is a product decision, not a coding one, and should be confirmed before Phase 1 header work.
- **Notes-as-single-text-blob (low):** If the sales team expects discrete, deletable note entries (like a comment thread), the current `leads.notes` single-text-column model won't satisfy that expectation. Reusing it as-is is schema-safe (rule #7) but is a UX tradeoff worth flagging rather than silently carrying forward.
- **Documents gap (medium):** Building real per-lead file attachments requires either a new table or a `lead_id` column added to the existing (wrong-domain) `documents` table, either of which is new schema — conflicts with "schema must remain unchanged unless absolutely required." Recommendation: treat Documents as an explicitly separate, stakeholder-approved follow-up rather than bundling it into the initial workspace scope.
- **Tasks — not a risk, a scope clarification needed:** Since it doesn't exist at all, confirm with the requester whether "Tasks" in their example list meant Follow-ups (which exists and covers "things to do for this lead") before building anything new.
- **Auth/route stability (low):** Every API route listed above already goes through `requireAuth()` and validated Zod schemas (`src/lib/validation.ts`). No route needs modification to be called from a new page — this significantly de-risks the whole plan, since "wiring" truly means "call the existing endpoint from a new place," not touching route code.

---

## Implementation Plan

### Phase 1 — Read-only workspace shell (highest leverage, lowest risk)
Scope: turn `dashboard/leads/[id]/page.tsx` into a tabbed shell and populate the read-only tabs by extracting and reusing existing display logic. No write actions yet.
- Extract `<LeadHeader>`, `<LeadTimeline>`, `<LeadProposals>`, `<AIAssistantPanel>` from `customers/[id]/page.tsx` into shared component files (pure move, no logic change).
- Add tab navigation shell (Overview / Timeline / Proposals / AI Assistant to start).
- Overview tab = today's existing Lead Details content, unchanged.
- Timeline, Proposals, AI Assistant tabs call the exact same three existing endpoints already used by Customer Profile.
- `customers/[id]/page.tsx` is updated to import the same extracted components (so behavior there is provably unchanged, and the duplication that exists today — two copies of the same UI — is eliminated, directly satisfying rule #2).
- **Independently deployable:** yes — purely additive UI, zero new API surface, zero schema change, zero write actions. Safe to ship alone.

### Phase 2 — Actions and remaining tabs
Scope: add the write-capable tabs and sidebar quick actions, plus the two small additive service touches identified in the Dependency Map.
- Add Follow Ups tab (extract Kanban's scheduler/note composer pattern) and Notes tab (same underlying `leads.notes` + `/api/followups` note action).
- Add Site Visits tab: add `listSiteVisitsForLead(leadId)` alongside the existing date-scoped function in `site-visit-service.ts`; thin list UI.
- Add Reservations tab: verify (or add) a lead-scoped filter on `GET /api/reservations`; reuse the Reservation Detail page's status-action pattern; must implement the graceful-degradation handling called out in Risk Analysis.
- Add sidebar Quick Actions: Call (`tel:` link), WhatsApp (`wa.me` link, copied from Kanban), Create Proposal (link-builder, copied from Kanban), Schedule Visit (link to `/visits/new?lead_id=`), AI Summary (Operator Assistant action, not Kanban's separate endpoint).
- Add Change Stage / Mark Won / Mark Lost control using `PATCH /api/leads/[id]/stage`, reusing `VALID_TRANSITIONS` filtering exactly as Kanban does.
- **Independently deployable:** yes, after Phase 1 — each tab/action is additive and calls only pre-existing, already-tested routes. Ship incrementally (e.g., Follow Ups + Notes first, then Site Visits + Reservations) if desired.

### Phase 3 — Owner assignment, Activity consolidation, and cleanup
Scope: the one genuinely new small control, plus tidying up the dead/duplicated code discovered during this audit.
- Build `<AssignOwnerControl>` (dropdown + `PATCH /api/leads {assigned_to}`) and place it in both the header and sidebar per the wireframe.
- Wire the Activity tab and "Recent Activity" bottom panel to `getCustomerTimeline()` (do not resurrect Kanban's dead `leadContext.activities` path — fix forward, not backward).
- Optional cleanup (separate, low-risk PRs): remove the two orphaned dead files found during the prior audit (`api/leads/[id]/stage/lead-stage-route.ts`, `api/proposal/share/[token]/api--proposal--share--token--route.ts`); centralize `fmtINR`/`fmtDate` into one `src/lib/format.ts` used by all extracted components instead of three redeclared copies.
- **Independently deployable:** yes — Owner Assignment is additive and isolated; the Activity/cleanup items touch no production behavior for end users.

### Explicitly out of scope pending a decision (not part of any phase above)
- **Documents tab** — requires new schema (or repurposing the wrong-domain `documents` table); flagged for a separate scoping conversation per rule #7.
- **Tasks** — does not exist; needs a decision on whether "Tasks" means Follow-ups (already covered) or a genuinely new concept, before any code is written.

---

Waiting for approval before any implementation begins.
