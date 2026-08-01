# Release — 2026-08-01 (Release Candidate 2)

**Supersedes**: `RC1_DEPLOYMENT_READINESS.md` (2026-07-29) for anything this release changes — RC1's migration/schema findings are not superseded (still current, no live re-check happened), only its feature scope is extended by everything below.

First actual entry in this directory — `docs/releases/` existed as a convention with no records until this one. Packages the work recorded in `docs/sprints/2026-08-01_revenue-conversion-and-rc2-hardening.md`.

## What shipped

Site Visit Scheduling completion (Sprint 1.5), Revenue Conversion Engine (Sprint 2 — Visit → Proposal Draft pipeline with a code-level Property Intelligence guard), Founder Dashboard (Sprint 3A), AI Hospitality Sales Consultant Policy (live prompt + Business Knowledge Base), an end-to-end real-business validation pass across 8 required customer journeys (one real gap found and fixed — chat-widget leads couldn't get an automatic proposal), and a production-database verification pass (two previously-unchecked migrations found, one previously-recorded-but-under-weighted schema drift risk elevated to Critical). Full detail in the sprint record above.

## Verification performed

- `tsc --noEmit -p tsconfig.json`: clean at every stage of this arc.
- `vitest run`: green throughout, 396 → 464 tests across the arc, zero regressions at any commit.
- `next build`: "✓ Compiled successfully" + clean lint + clean typecheck on every attempt; at least one full clean completion (all routes, including `/api/chat` and `/dashboard/founder`) per major change. All of this was run in this project's sandboxed environment, not a real CI/production build runner — **ENG-005 (get one confirmed build from a real machine/CI runner) remains open**, carried forward unchanged from `MASTER_BACKLOG.md`.
- **Live-database verification: none performed.** This sandbox has no network route to the production Supabase project — confirmed this arc with a captured, reproducible `403 blocked-by-allowlist` error from the sandbox's outbound proxy. Every claim about production schema/migration state in this release record is carried forward from prior sessions' documented findings or graded "Unknown," never asserted as fact.

## Known issues at release time

Carried forward, unresolved, cross-referenced to `docs/engineering/MASTER_BACKLOG.md`: ENG-001 (migration 012/013 live status), ENG-002 (migration 004), ENG-003 (schema drift, general), ENG-004 (reservation pricing-zeroing bug), ENG-005 (no confirmed real-CI build). New this release: ENG-033 (migration 027 unverified — Critical, blocks Site Visit scheduling), ENG-034 (migration 026 unverified — Medium), ENG-035 (`packages` column-naming drift may make Property Intelligence guards silently inert and zero out proposal pricing — Critical, highest-priority single check in the release).

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration 027 not live in production | Unknown (never checked) | Site Visit scheduling hard-fails on every attempt; Sprint 1/2's entire pipeline non-functional | Run `scripts/verify-migrations-026-027.sql` before relying on this feature in production; apply the (additive, idempotent) migration if missing |
| `packages` column-naming drift still current | Unknown (documented once, in an earlier RC1 session, never re-checked since) | Property Intelligence guards (Skyline-never-events, Monurama-100-cap) silently never fire; every AI-drafted proposal prices near ₹0 | Run `scripts/verify-packages-columns.sql` before trusting any AI-drafted proposal's price or venue guard in production — **highest-priority pre-launch check in this release** |
| Migrations 012/013 (Reservation Platform) not live | High (re-confirmed absent across 8+ sessions) | Entire Reservation module non-functional (502s or all-zero dashboard) | Unchanged from RC1 — apply before enabling reservations in production, or keep that module out of scope for this release's guest-facing launch |
| Reservation pricing-zeroing bug (ENG-004) | Unknown, unresolved | Reservation pricing could be wrong in a way no application test catches | Unchanged from RC1 — needs live-database access to isolate; not resolved by this release |

## Rollback plan

This release is application-code-only for its Site Visit/Revenue Conversion/Founder Dashboard/AI Policy features — no destructive migrations included (027/026, if applied, are additive-only with paired `_ROLLBACK.sql` files: `027_site_visit_fields_ROLLBACK.sql`, `026_campaign_landing_attribution_ROLLBACK.sql`). To roll back the application code: revert to the previous Vercel deployment (previous-deployment promotion) or `git revert` the commits on `release/v1.0.0-rc2` listed in the sprint record. To roll back either migration (only if it was applied and needs undoing): run the paired `_ROLLBACK.sql` file directly — both `DROP COLUMN IF EXISTS`, safe to run, but any data written into those columns since the migration went live is permanently lost, per this project's standard rollback-file convention (`MASTER_DATABASE.md`'s Database Evolution Policy).
