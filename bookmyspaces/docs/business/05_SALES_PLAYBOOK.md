# 05_SALES_PLAYBOOK.md — Business Knowledge Base

How a lead should be worked, in business terms. System mechanics (Kanban, stages, `lead-stage-manager.ts`) are in `docs/engineering/MASTER_ARCHITECTURE.md`; not repeated here.

## Confirmed guardrails (apply to every sales conversation)

- Skyline is accommodation-only — never pitch it for weddings, birthdays, or corporate events (`01_PROPERTY_INTELLIGENCE.md`). Route event-shaped leads to Monurama.
- Monurama proposals must never exceed 100 guests total; rooftop pitches should target the 40–50 ideal range; each hall pitches at up to 15.
- Every accepted proposal still requires human review/send — no proposal or quote goes to a guest without operator approval (`docs/engineering/MASTER_ARCHITECTURE.md`'s AI Safety & Approval Layer).

## Lead → Proposal → Reservation flow

Existing flow (`leads` → `proposals` → `invoices`/`reservations`), unchanged, per `MASTER_ARCHITECTURE.md`. This document does not redefine that flow — it constrains what content is put into it.

## Objection handling, qualification questions, closing scripts

**UNKNOWN - FOUNDER INPUT REQUIRED.** Not present anywhere in the repository. The AI Sales Assistant module (`docs/growth/06_AI_SALES_ASSISTANT.md`) is designed to eventually surface this kind of guidance in the Inbox, but is not built, and no actual scripts exist yet to seed it with.

## Cross-references

- AI-assisted selling roadmap: `docs/growth/06_AI_SALES_ASSISTANT.md`.
- Visit capture during a sales conversation: `09_VISIT_MANAGEMENT.md`.
- Standard-response wording for common questions: `08_STANDARD_RESPONSES.md`.
