# 15 — Loyalty Program

## Business Objective

Reward repeat stays with a simple points-or-tier system, using the customer lifetime value calculation that already exists (`lifetime-value.ts`) as the foundation, rather than building loyalty as a disconnected point system that doesn't know what the CRM already knows about a customer's history.

## User Journey

A guest completes their second stay at either property. The system (reusing the same revenue-recognition logic `lifetime-value.ts` already trusts) credits loyalty points automatically. On their third stay, they're shown as a "Gold" tier guest on the operator's customer detail view, and a small automatic perk (e.g., late checkout, a complimentary add-on) is suggested to the operator via the AI assistant (`06_AI_SALES_ASSISTANT.md`) rather than requiring the operator to remember tier benefits.

## Existing Code Reuse

- `src/lib/customers/lifetime-value.ts` — the exact revenue-per-customer computation (with its already-solved double-counting rule against `reservations.proposal_id`) is the natural input to tier calculation; this module should call this existing function, not recompute customer revenue independently.
- `reservation-workflow.ts`'s `checkOutReservation()` — the natural point-accrual trigger point, same pattern as `08_CUSTOMER_JOURNEY.md`'s post-stay messaging.
- `activity_logs` — tier changes and point accruals are timeline-worthy events via the existing `logActivity()` pattern.
- `packages`/`addon_services` — tier perks (a free add-on, a package discount) are redemptions against catalog items that already exist and are already priced; no new "perk catalog" needed, reuse the real one.

## Required Database Changes

- Additive: `loyalty_accounts` (`customer_id` FK, `points_balance`, `tier`, `updated_at`).
- Additive: `loyalty_ledger` (`id`, `customer_id`, `reservation_id`, `points_delta`, `reason`, `created_at`) — an append-only ledger (not just a running balance) so every accrual/redemption is auditable, consistent with this codebase's existing preference for auditable history (`admin_audit_log`, `stage_transitions`) over mutate-in-place state.
- Shares its reward-type vocabulary with `14_REFERRAL_SYSTEM.md` (decided jointly, per that module's Risks section).

## Required APIs

- `GET /api/customers/[id]/loyalty` (balance, tier, ledger) — additive route under the existing `/api/customers/[id]` family, not a new top-level resource.
- Internal accrual hook in `checkOutReservation()`.

## UI Changes

- Customer detail page: loyalty tier badge, points balance, ledger history — additive section on an existing page.
- Settings: tier thresholds and point-earn-rate as admin-configurable values (reusing the `settings` table pattern), not hardcoded constants — avoiding the exact hardcoded-pricing anti-pattern `AI_ARCHITECTURE.md` already flags as a problem for `SYSTEM_PROMPT`.

## AI Opportunities

- AI-suggested perk redemption at the point a repeat guest is being quoted a new stay (surfaced in `06_AI_SALES_ASSISTANT.md`'s next-best-action panel) — "this is a Gold-tier guest, consider offering the late-checkout perk," not an autonomous discount application.
- AI-flagged "about to reach next tier" nudges feeding `08_CUSTOMER_JOURNEY.md`'s messaging.

## Risks

- Financial-adjacent feature (points have implied monetary value) — redemption logic must go through the same validated service-layer convention as every other CRM write (`AI_ARCHITECTURE.md` Safety Rule 4: "All AI writes to CRM go through the same validated service layer as human writes"); no AI action should ever directly decrement a points balance without an explicit human-approved redemption action.
- Inherits A1 and A3 (`04_GAP_ANALYSIS.md`) directly: point accrual keyed on `reservations.status`/`final_room_rate` is not safe to build until migration 012 is live and BUG-004 is resolved and re-verified — accruing loyalty points off a field with a known, unresolved zeroing bug would silently under-reward (or, if the bug is intermittent, inconsistently reward) real guests.

## Dependencies

- `14_REFERRAL_SYSTEM.md` (shared reward model), `08_CUSTOMER_JOURNEY.md` (accrual/perk-nudge trigger points), A1/A3 in `04_GAP_ANALYSIS.md`.

## Development Priority

**P3, explicitly blocked on A3 resolution** — do not schedule engineering time against the accrual logic until BUG-004 is closed and independently re-verified against the live database; the ledger/tier UI scaffolding can be built earlier since it has no dependency on the pricing bug.
