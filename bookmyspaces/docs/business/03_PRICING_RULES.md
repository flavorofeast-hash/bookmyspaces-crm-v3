# 03_PRICING_RULES.md — Business Knowledge Base

How a price is supposed to be calculated — business logic only. Implementation lives in `src/lib/pricing/pricing-service.ts` (see `docs/engineering/MASTER_ARCHITECTURE.md`'s Hospitality/Booking layer); not restated here.

## Known structural facts

- Price is composed from `rate_plans` + `meal_plans` + `addon_services`, scoped to a specific `inventory_item`.
- Reservation-level pricing is state-machined through `reservation-workflow.ts` (`MASTER_ARCHITECTURE.md`).

## Known open issue — read before trusting any AI-generated quote

**BUG-004 (tracked as `ENG-004` in `docs/engineering/MASTER_BACKLOG.md`)**: Check Availability correctly returns a non-zero quote, but Create Reservation has been observed persisting `Rate = ₹0`. Root cause not isolated to application code as of the last investigation (see prior session's runtime tracing) — suspected live-DB or deploy-mismatch layer. **Do not treat AI- or system-quoted prices as final until this is resolved and re-verified against the live database.**

## Actual rate values, seasonal pricing, minimum stays

**UNKNOWN - FOUNDER INPUT REQUIRED.** No confirmed real rate-plan values exist in this knowledge base — the 3 rate plans in the RC1 seed fixture are test data, not a confirmed live price list. Founder needs to provide:

- Base nightly/per-slot rates per property and room/hall/rooftop.
- Any weekday/weekend or seasonal/festival rate variation.
- Minimum booking duration or minimum spend, if any.

## Cross-references

- Package-level pricing: `02_PACKAGES.md`.
- Discounting on top of base price: `04_DISCOUNT_POLICY.md`.
- Capacity ceilings that gate whether a quote should be generated at all: `01_PROPERTY_INTELLIGENCE.md`.
