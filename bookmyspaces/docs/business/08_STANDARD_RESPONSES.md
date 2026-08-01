# 08_STANDARD_RESPONSES.md — Business Knowledge Base

Canned/approved wording for common guest questions, so AI and operators answer consistently. WhatsApp already has deterministic state-machine conversations for some flows (`docs/engineering/MASTER_ARCHITECTURE.md`) — this document is meant to hold the actual copy those flows and AI chat should use.

## Categories needing standard copy

- Greeting / first response
- Availability inquiry (accommodation)
- Availability inquiry (events, Monurama only)
- Pricing inquiry (with the caveat from `03_PRICING_RULES.md` if reservation pricing is involved)
- Capacity/guest-count questions (must reflect `01_PROPERTY_INTELLIGENCE.md` ceilings verbatim)
- Visit-request handling (see `09_VISIT_MANAGEMENT.md` for required data capture)
- Out-of-scope requests (e.g., someone asking Skyline about a wedding — should redirect to Monurama, not just decline)
- Closing / next-steps

## Actual response copy

**UNKNOWN - FOUNDER INPUT REQUIRED.** No approved standard-response text exists in the repository for any of the categories above. Until provided, AI/operator responses to these categories are being freely generated rather than using approved wording.

## Cross-references

- Behavior constraints these responses must satisfy: `07_AI_BEHAVIOR_RULES.md`.
- Existing WhatsApp state-machine flow: `docs/engineering/MASTER_ARCHITECTURE.md`.
