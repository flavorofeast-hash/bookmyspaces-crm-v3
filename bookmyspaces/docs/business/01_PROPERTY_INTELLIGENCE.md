# 01_PROPERTY_INTELLIGENCE.md — Business Knowledge Base

Founder-confirmed facts about each property. This is the authority for "what can this property be sold for" — sales/marketing/AI content must not contradict it. Structural table references: `docs/engineering/MASTER_DATABASE.md` (`properties`, `inventory_items`).

## Skyline Serenity

- Accommodation only.
- No events. No banquet. No rooftop.
- **Hard rule**: never recommend Skyline for weddings, birthdays, or corporate events.
- Location: near Kolkata airport (per `docs/engineering/MASTER_PRODUCT.md`).
- Room count/names: seed fixture (`supabase/seed/rc1_catalog_test_seed.sql`) lists 4 rooms (Room 101, 102, 103, 104) — **UNKNOWN - FOUNDER INPUT REQUIRED**: confirm this reflects the real, current room inventory (seed file was built for RC1 testing, not confirmed as live catalog data).

## Monurama Homestay

- Accommodation + Events.
- Location: Mukundapur, EM Bypass (per `MASTER_PRODUCT.md`).
- Rooftop: ideal capacity 40–50.
- Hall 1: capacity 15.
- Hall 2: capacity 15.
- **Entire property maximum: 100 guests.**
- **Hard rule**: never generate a proposal above 100 guests.
- Room count/names: seed fixture lists 4 rooms + 1 "Banquet Hall" + 1 rooftop — **discrepancy flagged**: seed data models a single hall, but the confirmed rule above specifies two halls (Hall 1, Hall 2). This needs reconciliation — **UNKNOWN - FOUNDER INPUT REQUIRED**: is "Banquet Hall" being split/renamed into Hall 1 + Hall 2, or is Hall 2 a net-new space not yet in the catalog?

## Cross-references, not duplicated here

- Catalog schema (`inventory_items`, `rate_plans`, `meal_plans`, `addon_services`, `packages`): `docs/engineering/MASTER_DATABASE.md`.
- Property-fit guardrails as AI/system behavior: `07_AI_BEHAVIOR_RULES.md`.
- Capacity ceiling as a proposal-generation rule: `10_BUSINESS_RULES.md`.
