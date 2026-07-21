# BOOKMYSPACES V3 — MASTER SPECIFICATION

Last updated: 2026-07-21. Single source of truth for WHAT the platform is. See `BOOKMYSPACES_V3_MASTER_ARCHITECTURE.md` for HOW, `IMPLEMENTATION_ROADMAP.md` for WHEN.

## Product Vision

BookMySpaces V3 is an AI-Powered Omnichannel Hospitality Operations Platform, not a plain CRM. It unifies CRM, property management, booking management, AI customer engagement, marketing automation, social media management, and business intelligence around **one customer profile with one timeline**.

Business: hospitality (hotel / homestay / banquet / events), single-tenant, Kolkata market. Website: https://www.bookmyspaces.in

## Module Status Matrix

| Module | Status | Where |
|---|---|---|
| Auth (session middleware, RBAC, HMAC webhook) | ✅ Live | `src/middleware.ts`, `src/lib/auth-guard.ts` |
| Leads / Kanban / follow-ups / lead scoring | ✅ Live | `src/modules/leads`, `src/modules/followups` |
| Proposal engine (builder, PDF, share, tracking, intelligence, invoice, payments) | ✅ Live | `src/lib/proposals`, `src/app/api/proposals/*` |
| Email (Resend, provider-agnostic, logged) | ✅ Live | `src/lib/email/*` |
| WhatsApp (webhook, state machine, campaigns, queue) | ✅ Live | `src/lib/whatsapp/*`, `src/services/whatsapp` |
| Website AI chat | ✅ Live | `src/app/api/chat`, `src/components/chatbot` |
| Dashboards (operations, revenue, stats) + analytics | ✅ Live | `src/app/(crm)/dashboard`, `src/app/api/dashboard/*` |
| Reservations / availability / properties / pricing services | ✅ Built (service layer + UI) | `src/lib/reservations/*`, `src/app/(crm)/reservations` |
| Unified conversation engine (schema + service) | 🟡 Built, not cut over — WhatsApp/website still use legacy paths | `src/lib/conversations`, migration 012 |
| Identity resolution (multi-identifier) | 🟡 Built, not wired into live webhook paths | `src/lib/identity/resolve-identity.ts` |
| Knowledge base (`knowledge_sources`, retrieval) | 🟡 Built; retrieval is keyword-based, vector RAG infra unused | `src/lib/knowledge`, migrations 001/005/012 |
| AI operator assistant (suggested replies etc.) | 🟡 Built, needs agent console UI | `src/lib/ai/operator-assistant.ts` |
| Admin UI for inventory / rate plans / meal plans / add-ons | ❌ Missing (raw SQL today) | VERSION1_1 Tier 1 #1 |
| Settings backend (page saves to localStorage only) | ❌ Missing (`settings` table exists in 012, unwired) | `src/app/(crm)/settings` |
| FB Messenger / Instagram DM / GBP / email-in adapters | ❌ Missing | — |
| Social Media Command Center | ❌ Missing (new module) | `SOCIAL_MEDIA_ARCHITECTURE.md` |
| Marketing automation (ads platforms) | ❌ Missing | — |
| Housekeeping / maintenance / check-in-out ops | ❌ Missing | VERSION1_1 Tier 3 |
| OTA channel manager | ❌ Missing | VERSION1_1 Tier 2 |

## Functional Requirements (summary)

### Unified Conversation Engine
Every message from every channel flows: Channel → Conversation Adapter → Identity Resolution → CRM → AI Orchestrator → (Human Agent when needed). Merge on phone, email, WhatsApp ID, social identifiers, existing CRM records. Never create duplicate customers. One timeline per customer.

### AI First Contact
AI answers FAQs, explains rooms/packages/pricing/availability/offers/facilities, collects booking requirements, qualifies leads, recommends packages, generates proposals, schedules site visits/callbacks, creates follow-ups, and updates the CRM automatically. AI responses must be grounded in the editable knowledge base (`knowledge_sources`), never hardcoded prompt constants.

### AI Memory
Remember previous conversations, bookings, proposals, preferences, language, special requests. Never ask twice for known information. Source: unified timeline + `customer_identities`.

### Human Handoff
Triggers: explicit request, low AI confidence (configurable threshold in `settings`), complaint/dispute, refund, payment issue, VIP, admin intervention. Handoff payload: full history, AI summary, suggested replies, next best actions. Human can return control to AI.

### AI-Assisted Human Chat
Suggested replies, rewrite, grammar, translation, tone, upsell/cross-sell, next best action. Human retains final control. Customer-facing documents (proposals, brochures) require human approval before sending.

### Lead & Proposal Automation
Auto-extract: name, phone, email, event type, guest count, budget, dates, property, requirements → create/update lead. When sufficient info exists, recommend: generate proposal / send brochure / WhatsApp or email proposal / book site visit / schedule follow-up.

### Social Media Command Center (high priority — see SOCIAL_MEDIA_ARCHITECTURE.md)
Unified social inbox (DMs, comments, mentions, reviews, story/post replies) linked to CRM profiles; AI auto-responder with sentiment + escalation; content studio; content calendar; campaign manager; review management; social analytics with revenue attribution; social listening.

### Dashboards
Revenue, leads, bookings, occupancy, AI vs human conversations, escalations, response times, conversion, channel performance, social analytics, marketing ROI.

## Non-Functional Requirements

- Extend existing V3; never rebuild. Reuse before writing new code. No duplicate implementations.
- CRM (Supabase Postgres) is the system of record.
- All integrations behind modular adapters; adding a channel must not change CRM core.
- Additive-only migrations; backward compatibility unless a breaking change is explicitly approved.
- Every phase ends deployable: build + `tsc --noEmit` + lint + `vitest run` green, docs updated.
- Human approval gate on all outbound customer-facing documents and on destructive actions.
