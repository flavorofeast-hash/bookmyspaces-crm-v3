# 13 — Email Marketing

## Business Objective

Email today is transactional-only: proposals, invoices, payment reminders, receipts, all sent via `src/lib/email/{provider,send,templates}.ts` (Resend-backed) and logged to `email_log`. This module adds email as a genuine marketing channel — campaigns, journey messages — alongside WhatsApp, without duplicating the send infrastructure.

## User Journey

An operator (or an automated journey trigger from `08_CUSTOMER_JOURNEY.md`) sends a marketing email to a segment (`05_MARKETING_PLATFORM.md`). The recipient can unsubscribe with one click; that preference is respected by every future send, campaign or transactional-adjacent, without the operator having to remember to check a suppression list manually.

## Existing Code Reuse

- `src/lib/email/provider.ts` — provider-agnostic `sendEmail()` (`EmailInput`/`EmailResult` shapes), already abstracted from Resend specifically per its own header comment ("swapping to SMTP or SendGrid later means writing one new function in this file... no caller needs to change"). This module's sends go through this exact function, not a new email client.
- `email_log` (migration 011) — delivery logging already exists; extend with a `campaign_id` column (additive) for the same attribution pattern `campaign-scheduler.ts` already established for WhatsApp.
- `src/lib/email/templates.ts` — template convention to extend for marketing content, following the same pattern as transactional templates.

## Required Database Changes

- Additive: `email_suppressions` (new table — `email`, `reason` [unsubscribed/bounced/complained], `created_at`). This is the one genuinely new piece of data infrastructure this module needs, and it is a compliance requirement, not optional polish.
- Additive: `email_log.campaign_id` (nullable FK), mirroring `message_queue.metadata.campaign_id`'s existing attribution pattern.

## Required APIs

- `GET /api/email/unsubscribe?token=` (public, capability-token pattern already used elsewhere in this codebase for `/api/proposal/share/[token]` — reuse that exact convention rather than inventing a new auth-free-route pattern) — writes to `email_suppressions`.
- Extend `/api/campaigns` (per `09_CAMPAIGN_ENGINE.md`) to check `email_suppressions` before every marketing send — this check belongs in the shared send path, not duplicated per caller.

## UI Changes

- Campaigns page: email as a channel option (per `09_CAMPAIGN_ENGINE.md`).
- Settings or a new lightweight "Suppressions" admin view to see/manually manage the unsubscribe list (support requests, manual opt-outs).

## AI Opportunities

- AI-drafted marketing email copy/subject lines via `ai-provider.ts`, same pattern as WhatsApp campaign copy.
- AI subject-line A/B suggestion — a reasonable v2 feature once basic sending and attribution exist, not a v1 requirement.

## Risks

- **Compliance is the primary risk of this entire module**, more than any technical risk: sending marketing email without unsubscribe handling is the one part of this plan with real legal exposure (India's DPDP Act and general anti-spam norms). This module should not ship without `email_suppressions` and the unsubscribe link live from day one — sequencing this ahead of `09_CAMPAIGN_ENGINE.md`'s email-channel support is deliberate, not incidental.
- No inbound email adapter exists yet (`03_SYSTEM_AUDIT.md` names this gap) — this module is outbound marketing only; inbound email-as-a-conversation-channel is `07_OMNICHANNEL.md`/Phase 4 scope per `IMPLEMENTATION_ROADMAP.md`, not this module.

## Dependencies

- `05_MARKETING_PLATFORM.md` (segments), `09_CAMPAIGN_ENGINE.md` (campaign UI/orchestration).

## Development Priority

**P1 for the compliance scaffolding (suppressions + unsubscribe), P2 for the rest** — split priority deliberately: the suppression list is small, self-contained, and should exist before any other module sends a single marketing email.
