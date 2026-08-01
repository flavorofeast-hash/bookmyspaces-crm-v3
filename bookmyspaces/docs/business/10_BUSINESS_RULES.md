# 10_BUSINESS_RULES.md — Business Knowledge Base

Master index of confirmed, hard business rules. Each rule is sourced from a specific document — this file does not restate the reasoning, only consolidates the rule for quick lookup.

| # | Rule | Applies to | Source |
|---|---|---|---|
| 1 | Accommodation only — no events, banquet, or rooftop | Skyline Serenity | `01_PROPERTY_INTELLIGENCE.md` |
| 2 | Never recommend for weddings, birthdays, or corporate events | Skyline Serenity | `01_PROPERTY_INTELLIGENCE.md`, `07_AI_BEHAVIOR_RULES.md` |
| 3 | Rooftop ideal capacity 40–50 | Monurama | `01_PROPERTY_INTELLIGENCE.md` |
| 4 | Hall 1 capacity 15 | Monurama | `01_PROPERTY_INTELLIGENCE.md` |
| 5 | Hall 2 capacity 15 | Monurama | `01_PROPERTY_INTELLIGENCE.md` |
| 6 | Entire property maximum 100 guests | Monurama | `01_PROPERTY_INTELLIGENCE.md` |
| 7 | Never generate a proposal above 100 guests | Monurama | `01_PROPERTY_INTELLIGENCE.md`, `05_SALES_PLAYBOOK.md`, `07_AI_BEHAVIOR_RULES.md` |
| 8 | Capture Name/Mobile/Date/Time/Purpose/Guest Count/Budget and auto-create a Site Visit on request | All properties | `09_VISIT_MANAGEMENT.md` |
| 9 | No customer-facing AI send without human approval | All properties | `docs/engineering/MASTER_ARCHITECTURE.md`, `07_AI_BEHAVIOR_RULES.md` |
| 10 | Reservation pricing not to be trusted as final until BUG-004/ENG-004 is resolved | All properties | `03_PRICING_RULES.md`, `docs/engineering/MASTER_BACKLOG.md` |
| 11 | A site visit is a customer choice, never a target the AI maximizes — recommend only when it helps the customer decide | All properties | `07_AI_BEHAVIOR_RULES.md`, `09_VISIT_MANAGEMENT.md` |
| 12 | Escalate to a human on: explicit request, blocked business rule, requested exception/special pricing, trust-affecting uncertainty, or low AI confidence | All properties | `07_AI_BEHAVIOR_RULES.md` |

## Known gap, not a rule

Hall count discrepancy between the RC1 seed fixture (1 hall) and rule #4/#5 above (Hall 1 + Hall 2) is unresolved — see `01_PROPERTY_INTELLIGENCE.md`. Treat rules #4/#5 as authoritative until reconciled.

## Cross-references

This document is an index only. For the reasoning, exceptions, and open questions behind any rule, read the sourced file — do not copy rule text out of this table into other documents; link back here instead.
