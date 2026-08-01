# 20 — Implementation Roadmap

Sequenced across every module in this document set, respecting the dependencies and priorities each module doc already states. This roadmap sits alongside — does not replace — the existing `IMPLEMENTATION_ROADMAP.md` at the repo root, which covers the platform's operational/architectural phases (unified conversation cutover, AI depth, new channels). This roadmap is the growth-specific overlay: it assumes that root roadmap's Phase 0–2 either are complete or are running in parallel, and calls out explicitly where a growth module is blocked on one of those phases.

## Phase G0 — Foundation Verification (do first, blocks almost everything)

Not a feature phase — a verification phase, because this session's own RC1 testing found real, concrete evidence that "the migration file describes reality" cannot be assumed (`04_GAP_ANALYSIS.md` A1–A3).

1. Confirm migration 012/013 apply status against the live database directly (the one-shot verification query already written in `RC1_DEPLOYMENT_READINESS.md` §1) — resolve one way or the other, don't proceed on an assumption.
2. Re-verify the live schema for every table any growth module touches (`reservations`, `packages`, `reviews`, `analytics_events`) against actual `information_schema.columns` output — not against the migration files — given the confirmed drift already found on `packages` (BUG-003).
3. Resolve BUG-004 (reservation pricing zeroing) and re-verify against the live database that a real Create Reservation produces a non-zero `final_room_rate`. Every revenue-keyed growth feature (loyalty accrual, referral credit, journey messages referencing stay value) is blocked on this.
4. Finish or explicitly re-scope the unified-conversation cutover (`07_OMNICHANNEL.md`) — confirm dual-write parity, decide on legacy-table retirement timing.

**Exit criteria**: a documented, live-verified statement of (a) which tables are actually live, (b) their actual column shapes, (c) that reservation creation actually persists a correct price, (d) unified conversation parity status. This phase produces a short verification report, not code.

## Phase G1 — High-Leverage, Low-Risk Wins (P0/P1 modules, mostly UI over existing logic)

Can start in parallel with G0 where a module doesn't touch the tables under verification.

- `07_OMNICHANNEL.md` (P0) — finish the inbox cutover.
- `06_AI_SALES_ASSISTANT.md` (P1) — surface `operator-assistant.ts` in the Inbox. Highest value-to-effort ratio in this entire plan.
- `05_MARKETING_PLATFORM.md` (P1) — segments + attribution scaffolding.
- `13_EMAIL_MARKETING.md`'s compliance scaffolding only (P1 slice) — suppression list + unsubscribe link, ahead of any actual marketing email sends.

## Phase G2 — Core Growth Modules (P2)

Depends on G1's scaffolding (segments, email compliance, finished inbox) and G0's foundation verification for anything reservation-linked.

- `09_CAMPAIGN_ENGINE.md` — multi-channel campaigns on top of G1's segments/email work.
- `08_CUSTOMER_JOURNEY.md` — lifecycle automation (blocked on G0's BUG-004 resolution specifically for any rate-referencing message).
- `10_SOCIAL_MEDIA.md` — finish the publishing pipeline (`post-service.ts`'s documented gap).
- `16_REVIEW_MANAGEMENT.md` — can start once at least one review source (Meta, already live) is ingesting.
- `12_WHATSAPP_AUTOMATION.md` — incremental improvements to the existing deterministic engine.
- `18_ANALYTICS.md` — attribution dashboards, once G2's campaign/email modules produce attribution data to read.
- `11_GOOGLE_BUSINESS.md` — gated on its own API-availability spike (do the spike early in this phase even if the full build waits).

## Phase G3 — Multiplier Modules (P3)

Depends on G2 modules for both data and, in the loyalty/referral case, a jointly-decided reward model.

- `14_REFERRAL_SYSTEM.md` and `15_LOYALTY_PROGRAM.md` — build the shared reward-type model first, then both modules; loyalty accrual is further blocked on G0's BUG-004 resolution.
- `17_SEO_AND_CONTENT.md` — pending the public-website architecture question this module's own doc raises.
- `19_AI_RECOMMENDATIONS.md` — deliberately last; needs G2's journey/campaign/review data to have real substance.

## Cross-cutting, apply throughout every phase

- Every new cron route inherits the `CRON_SECRET` fail-open risk (`04_GAP_ANALYSIS.md` A4) until that's fixed at the platform level — treat as a pre-launch checklist item for each phase's cron additions, not a one-time fix.
- Every module doc's "Existing Code Reuse" section is the literal starting point for that module's engineering — read the named files before writing anything new, per this plan's own governing principle (reuse before building).
- Every phase should end the way the root `IMPLEMENTATION_ROADMAP.md` already mandates: build + `tsc --noEmit` + lint + `vitest run` green, `CHANGELOG.md` and affected docs updated.

## Rough sequencing summary

```
G0 (verification)  ──┬── G1 (Omnichannel, AI Assistant, Segments, Email compliance)
                      │
                      └──> G2 (Campaigns, Journeys, Social publish, Reviews, WhatsApp, Analytics, GBP)
                                │
                                └──> G3 (Referral, Loyalty, SEO/Content, AI Recommendations)
```

No calendar estimate is given here deliberately — this repo's own `RC1_DEPLOYMENT_READINESS.md` and this session's testing both demonstrate that "presumed done" and "actually verified" have diverged before on this project; committing to dates before G0's verification report exists would repeat that mistake at the planning level.
