# 04_DISCOUNT_POLICY.md — Business Knowledge Base

When and how much discount is allowed.

## Known structural facts

- `packages` has a `standard_discount_pct` column, i.e. the schema already supports a per-package standard discount (verified live schema, RC1 session).
- No discount logic beyond this column is known to exist in the codebase today.

## Actual policy

**UNKNOWN - FOUNDER INPUT REQUIRED.** None of the following are confirmed:

- What `standard_discount_pct` values should be, per package.
- Whether operators can discount ad hoc beyond the standard, and if so, up to what limit or with what approval.
- Repeat-guest, referral, or off-season discount rules (the growth-platform referral/loyalty designs in `docs/growth/14_REFERRAL_SYSTEM.md` and `docs/growth/15_LOYALTY_PROGRAM.md` propose mechanisms but are **designed, not built**, and carry no confirmed discount percentages).
- Whether AI is ever allowed to quote a discounted price unprompted, or only apply a discount an operator has approved (default assumption per `07_AI_BEHAVIOR_RULES.md`: no unapproved discounting).

## Cross-references

- Base pricing before discount: `03_PRICING_RULES.md`.
- AI's authority to apply a discount: `07_AI_BEHAVIOR_RULES.md`.
