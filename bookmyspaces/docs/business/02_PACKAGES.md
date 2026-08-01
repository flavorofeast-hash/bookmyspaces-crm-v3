# 02_PACKAGES.md — Business Knowledge Base

What packages exist and what they may legally/practically include, per property. Schema reference only — not a repeat of table structure (see `docs/engineering/MASTER_DATABASE.md` for `packages` columns).

## Known structural facts

- `packages.type` is constrained to `dining` or `rooftop` (verified live schema, RC1 session).
- `packages.property` is free text (verified live schema, RC1 session).
- `packages` supports a `standard_discount_pct` column — see `04_DISCOUNT_POLICY.md` for how this should be used.
- Event packages exist only for Monurama — Skyline has no event packages (per `01_PROPERTY_INTELLIGENCE.md`'s "no events" rule).
- Monurama packages must respect the 100-guest property ceiling and the 40–50 rooftop / 15-per-hall capacities from `01_PROPERTY_INTELLIGENCE.md`.

## Package catalog (names, inclusions, pricing)

**UNKNOWN - FOUNDER INPUT REQUIRED.** The 3 event packages present in `supabase/seed/rc1_catalog_test_seed.sql` are RC1 test fixtures created to exercise the schema — they are not confirmed as the real, sellable package lineup. Founder needs to confirm or provide:

- Actual package names and what's included in each (rooftop vs. hall vs. combined).
- Actual pricing per package (flat, per-guest, or tiered).
- Any seasonal/festival package variants.

## Cross-references

- Pricing mechanics (how a package price becomes a quote): `03_PRICING_RULES.md`.
- Discount eligibility: `04_DISCOUNT_POLICY.md`.
- Growth-platform package/upsell ideas (not yet built): `docs/growth/19_AI_RECOMMENDATIONS.md`.
