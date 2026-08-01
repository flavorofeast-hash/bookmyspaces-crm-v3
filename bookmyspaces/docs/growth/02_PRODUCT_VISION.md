# 02 — Product Vision: AI-Powered Hospitality Growth Platform

## From CRM to Growth Platform

Today, per `BOOKMYSPACES_V3_MASTER_SPECIFICATION.md`, BookMySpaces defines itself as "an AI-Powered Omnichannel Hospitality Operations Platform... one customer profile with one timeline." That definition is correct but operations-facing: it describes how a lead becomes a booking. It does not yet describe how a stranger becomes a lead, how a guest becomes a repeat guest, or how a repeat guest becomes a referral source. Those three motions — **acquire, convert-and-delight, retain-and-multiply** — are what "Growth Platform" adds.

Borrowing the parts of HubSpot, Salesforce, Cloudbeds, Odoo, and Booking.com that are actually relevant to a two-property Kolkata hospitality business (not their full feature surfaces):

- **HubSpot**: marketing automation as workflows/sequences triggered off CRM state, not a separate silo — `09_CAMPAIGN_ENGINE.md` and `08_CUSTOMER_JOURNEY.md` apply this directly to `leads`/`reservations` state changes already in the schema.
- **Salesforce**: an AI copilot embedded in the agent's actual work surface (the inbox), not a separate chat window — this is exactly what surfacing `operator-assistant.ts` in the Inbox does (`06_AI_SALES_ASSISTANT.md`).
- **Cloudbeds**: reviews, channel reputation, and guest communication tied directly to the reservation record — `16_REVIEW_MANAGEMENT.md`.
- **Odoo**: modules that share one data model instead of bolting on separate apps — every module in this set is designed against tables that already exist or additively extend them, never a parallel system.
- **Booking.com**: the guest-facing trust signals (reviews, instant answers, urgency/availability messaging) that convert browsers into bookers — informs `17_SEO_AND_CONTENT.md` and `16_REVIEW_MANAGEMENT.md`.

## The growth loop this platform is designed around

```
 ┌────────────┐    ┌──────────────┐    ┌─────────────┐    ┌───────────────┐
 │  Discover   │ -> │   Engage      │ -> │   Convert    │ -> │   Delight      │
 │ (SEO, GBP,  │    │ (AI chat,     │    │ (proposal,   │    │ (journey msgs, │
 │  social,    │    │  WhatsApp,    │    │  payment,    │    │  reviews, CS)  │
 │  referral)  │    │  inbox)       │    │  reservation)│    │                │
 └────────────┘    └──────────────┘    └─────────────┘    └───────┬───────┘
        ^                                                          │
        │                    ┌───────────────┐                     │
        └────────────────────┤   Multiply     │<────────────────────┘
                              │ (referral,     │
                              │  loyalty,      │
                              │  review-ask)   │
                              └───────────────┘
```

Every stage of this loop already has a data anchor in the schema: `leads` (Discover/Engage), `proposals`/`reservations` (Convert), `activity_logs`/`unified_messages` (Delight), and — once built — `referrals`/`loyalty_accounts`/`reviews` (Multiply). The modules in this document set are organized around closing the loop, not around introducing a new architecture to support it.

## Product principles carried forward (unchanged from existing docs)

From `BOOKMYSPACES_V3_MASTER_SPECIFICATION.md`'s Non-Functional Requirements, restated because every module design below is held to them:

1. Extend existing V3; never rebuild. Reuse before writing new code.
2. Supabase Postgres remains the single system of record.
3. Every new channel/integration is an adapter; adding one never changes CRM core.
4. Additive-only migrations; no renames/drops without explicit approval.
5. Human approval gate on outbound customer-facing sends and destructive actions.
6. Every module must degrade gracefully if its migration isn't yet applied (the established `DEFAULT_SETTINGS`/empty-array convention already used in `settings-service.ts`, `property-service.ts`, `pricing-service.ts`).

## What "growth" means for a two-property, single-tenant hospitality business

This is not a multi-tenant SaaS growth platform — it's the growth stack for one operator running Skyline Serenity and Monurama Homestay. That constrains and simplifies scope in ways worth stating explicitly:

- No multi-tenant billing, plan tiers, or per-tenant isolation needed anywhere in this plan.
- Marketing automation targets a customer base in the thousands, not millions — every design in `09_CAMPAIGN_ENGINE.md` is sized for that (no need for a dedicated ESP-scale sending infrastructure beyond what `queue.ts`/Resend already provide).
- Social and SEO scope is two physical properties in one metro market (Kolkata) — `17_SEO_AND_CONTENT.md` and `11_GOOGLE_BUSINESS.md` are scoped to local SEO/GBP, not a national content operation.
- The "AI-powered" part is not a gimmick layer on top — it's the same orchestrator, provider layer, and knowledge base already live for support/sales, extended to run the growth motions (next-best-action, churn-risk flagging, content generation, review-response drafting) so there is exactly one AI system to operate, not several.

## Success looks like

- A lead's full journey — first touch (any channel) through booking through post-stay review — visible on one timeline, with the system proactively suggesting the next action at every stage (already partially true for sales; extended here through delight/multiply).
- Marketing spend and organic channels (social, GBP, referral, SEO) attributed to actual bookings in the same Revenue Intelligence dashboard that already exists, not a separate marketing analytics tool.
- Repeat-guest rate and referral-sourced bookings tracked as first-class metrics, not manually reconstructed from `payments`/`proposals` after the fact (a gap `18_ANALYTICS.md` addresses directly on top of the already-built `lifetime-value.ts`).
