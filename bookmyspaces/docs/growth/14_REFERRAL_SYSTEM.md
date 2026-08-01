# 14 — Referral System

## Business Objective

Turn happy guests into an acquisition channel: a trackable referral code/link per customer, a reward on the referred guest's first completed stay, and visibility into referral-sourced revenue in the same Revenue Intelligence dashboard that already exists — closing the "Multiply" stage of the growth loop in `02_PRODUCT_VISION.md`.

## User Journey

After a stay (triggered the same way `08_CUSTOMER_JOURNEY.md`'s post-stay message fires), a guest receives a referral link/code via WhatsApp or email. A new prospect books using that code; on that new reservation's completion (`checked_out`, revenue-recognized status — the same status set `lifetime-value.ts` already uses to avoid double-counting), the referring guest is credited, and the operator sees "3 bookings, ₹42,000 in revenue from referrals this quarter" without manually reconstructing it from `payments`.

## Existing Code Reuse

- `leads.source` — already a CHECK-constrained enum (migrations 016/017 already added `proposal`/`excel_import` as values additively) — the exact same additive pattern adds a `referral` value here.
- `src/lib/customers/lifetime-value.ts` — its revenue-source and double-counting logic (accepted proposals + non-proposal-linked recognized reservations) is exactly the computation a referral-attribution report needs; reuse the same query shape rather than writing a second revenue calculator.
- `src/lib/queue.ts`/`templates.ts` — referral link delivery is just another WhatsApp/email send through the existing infrastructure.
- `activity_logs`/`logActivity()` — referral credit events belong on the customer timeline via the existing pattern.

## Required Database Changes

- Additive: `referral_codes` (`id`, `customer_id` FK → `leads`, `code`, `created_at`, `is_active`).
- Additive: `referral_credits` (`id`, `referrer_customer_id`, `referred_customer_id`, `reservation_id`, `credit_type` [cash/loyalty-points — see `15_LOYALTY_PROGRAM.md`], `amount_or_points`, `status` [pending/confirmed/paid], `created_at`).
- `leads.referred_by_code` (nullable, additive) or a join through `referral_credits` — decide based on whether "referred by" needs to be queryable before a reservation completes (likely yes, for attribution even on abandoned leads).

## Required APIs

- `POST /api/referrals/code` (generate/fetch a customer's code), `GET /api/referrals/credits?customerId=` (a customer's referral history), internal hook in `reservation-workflow.ts`'s `checkOutReservation()` (or wherever revenue-recognition finalizes) to create a `referral_credits` row when a referred reservation completes.
- Public-facing: if referral codes are meant to be redeemable on a public booking form, that form is out of scope for this module (BookMySpaces' booking intake today is WhatsApp/chat/operator-entered, not a public self-serve booking page) — the code needs to be capturable wherever a new lead is created (WhatsApp intake, website chat, manual entry), which means adding an optional "referral code" field to lead-creation paths, not a new booking engine.

## UI Changes

- Customer detail page: referral code, referral history, pending/confirmed credits.
- Revenue Dashboard: "Referral-sourced revenue" as an additional breakdown, reusing the existing dashboard's layout conventions rather than a new page.

## AI Opportunities

- AI-identified "likely referrers" (high-satisfaction repeat guests, per sentiment signals already computed in `interaction-service.ts` for social and extendable to post-stay surveys) to proactively prompt for referrals rather than blanket-asking every guest.

## Risks

- Reward/payout logic (cash vs. loyalty points vs. discount) is a real product decision this document does not make — `15_LOYALTY_PROGRAM.md` and this module should share one "reward type" model rather than each inventing its own, decided before either is built.
- Fraud/abuse (self-referral, fake accounts) — mitigate by tying credit issuance to a *revenue-recognized* reservation status (same set `lifetime-value.ts` already trusts), not to lead creation, so a code being used costs nothing until a real paid stay completes.
- Inherits A1 (`04_GAP_ANALYSIS.md`) if credit issuance depends on `reservations.status` transitions from the not-yet-applied migration 012 schema.

## Dependencies

- `08_CUSTOMER_JOURNEY.md` (delivery trigger), `15_LOYALTY_PROGRAM.md` (shared reward model), `18_ANALYTICS.md` (attribution reporting).

## Development Priority

**P3** — genuine growth value, but correctly sequenced after the loyalty reward model is jointly decided and after the journey-automation delivery mechanism (`08`) exists to trigger it.
