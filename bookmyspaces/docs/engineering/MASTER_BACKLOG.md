# MASTER_BACKLOG.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Every ticket below now carries **Business Priority** (Critical/High/Medium/Low — business impact if left undone), **Estimated Effort** (S/M/L), and **Dependencies** where one ticket meaningfully blocks or is blocked by another. Priority is about business risk, not just engineering tidiness — e.g. an unverified migration is Critical because it can silently corrupt guest-facing pricing, while a dead-code cleanup is Low even though both are "technical debt."

Flat, ticket-sized backlog consolidating known issues and technical debt from `RELEASE_REPORT.md`, `SECURITY_REVIEW.md`, `PERFORMANCE_REVIEW.md`, `UI_UX_REVIEW.md`, and this session's own RC1 findings. Prefixed `ENG-` to avoid colliding with this project's other numbering: `BUG-`/`ISS-` (session-specific bug/issue tracking) and `GRW-` (`docs/growth/21_BACKLOG.md`'s growth-platform tickets). Ordered by urgency, not by module.

## Must-verify-before-any-release (Phase 0 blockers)

- **ENG-001** Confirm migration 012/013 apply status against the live database. *(Blocks nearly everything reservation-related.)* — **Priority:** Critical · **Effort:** S · **Dependencies:** None; blocks ENG-004.
- **ENG-002** Confirm migration 004 (`broadcast_campaigns`, `festival_calendar`) apply status — possible risk of the Campaigns page 500ing in production if not live. — **Priority:** High · **Effort:** S · **Dependencies:** None.
- **ENG-003** Re-verify live schema for `packages`, `reservations`, `reviews`, `analytics_events` against `information_schema.columns` — confirmed drift already found on `packages` this session. — **Priority:** Critical · **Effort:** S · **Dependencies:** None; informs ENG-004.
- **ENG-004** Resolve and re-verify the open reservation-pricing-zeroing issue at the database layer. — **Priority:** Critical · **Effort:** M · **Dependencies:** ENG-001, ENG-003 (needs confirmed schema/migration state to isolate root cause).
- **ENG-005** Get one confirmed, logged `npm run build` pass from a real machine/CI runner. — **Priority:** High · **Effort:** S · **Dependencies:** None.
- **ENG-006** Set `CRON_SECRET` in every environment; confirm all 4 (and growing) cron routes reject unauthenticated requests. — **Priority:** High · **Effort:** S · **Dependencies:** None.
- **ENG-007** Set `WHATSAPP_APP_SECRET` in every environment; confirm webhook signature verification is actually enforced, not silently no-op'd. — **Priority:** High · **Effort:** S · **Dependencies:** None.
- **ENG-008** Commit and push all outstanding work from an environment with real git access. — **Priority:** Critical · **Effort:** S · **Dependencies:** None; prerequisite for any other ticket's changes to persist.
- **ENG-033** Verify migration 027 (`follow_ups.property/purpose/guest_count/budget`) against production before relying on Site Visit scheduling. `scheduleSiteVisit()` INSERTs these columns by name — a hard Postgres failure, not a graceful degradation, if the migration hasn't landed. Blocks the entire Site Visit → Proposal pipeline (Sprint 1/2). Exact SQL: `scripts/verify-migrations-026-027.sql`. — **Priority:** Critical · **Effort:** S · **Dependencies:** None; found `PRODUCTION_VERIFICATION_REPORT.md` (2026-08-01).
- **ENG-034** Verify migration 026 (`leads.campaign/landing_page/utm_*/referral`) against production. Same script as ENG-033. Lower blast radius — campaign attribution, not the core booking pipeline. — **Priority:** Medium · **Effort:** S · **Dependencies:** None; found `PRODUCTION_VERIFICATION_REPORT.md` (2026-08-01).
- **ENG-035** Verify `packages.venue`/`base_price`/`max_guests` exist live under those exact names — `MASTER_DATABASE.md`'s own recorded RC1 finding says the live table may instead use `property`/`price`/`capacity_max`. If so, `package-service.ts`'s `mapPackageRow()` silently maps every package to `venue: undefined, basePrice: 0`, meaning the Skyline-never-events / Monurama-100-cap guards in `auto-package-recommendation.ts` never fire and every AI-drafted proposal prices near ₹0. This is the highest-priority single check in the whole verification suite — revenue- and safety-critical, not cosmetic. Exact SQL: `scripts/verify-packages-columns.sql`. Supersedes ENG-003's general framing with a specific, actionable check. — **Priority:** Critical · **Effort:** S · **Dependencies:** None; found `PRODUCTION_VERIFICATION_REPORT.md`'s 2026-08-01 addendum.

## Security hardening (from `MASTER_SECURITY.md`)

- **ENG-010** Sweep for any additional `.or()` filter-string construction from user input beyond the two already-fixed sites; confirm sanitization pattern applied everywhere. — **Priority:** High · **Effort:** M · **Dependencies:** None.
- **ENG-011** Sweep for any additional message-string-interpolated PII in logging calls beyond the ~9 already-fixed WhatsApp-module sites. — **Priority:** High · **Effort:** M · **Dependencies:** None.
- **ENG-012** Decide, deliberately and once, whether `CRON_SECRET`/`WHATSAPP_APP_SECRET` should ever move from fail-open to fail-closed — currently accepted risk by design, worth a periodic revisit, not a silent permanent decision. — **Priority:** Medium · **Effort:** S · **Dependencies:** ENG-006, ENG-007 (secrets must be set everywhere before fail-closed is even viable).
- **ENG-013** Delete the confirmed-dead `api--proposal--share--token--route.ts` file and the deprecated `CRMShell.tsx` component (blocked by sandbox filesystem permissions in prior sessions — do from an environment with real delete access). — **Priority:** Low · **Effort:** S · **Dependencies:** None.

## Performance (from `MASTER_ARCHITECTURE.md`/`PERFORMANCE_REVIEW.md`)

- **ENG-020** Move `POST /api/followups` (`action: 'bulk'`) off synchronous per-request sending onto the existing `message_queue`/`campaign-scheduler.ts` infrastructure — current implementation risks exceeding its own function timeout on a full 20-lead batch. — **Priority:** High · **Effort:** M · **Dependencies:** Reuses existing `message_queue`/`campaign-scheduler.ts` (no new infra needed).
- **ENG-021** Design SQL-side aggregation (views/RPCs) for Revenue Intelligence / dashboard queries as a triggered migration once `leads`/`proposals`/`reservations` approach tens of thousands of rows — not urgent at current volume, tracked so it isn't forgotten. — **Priority:** Medium · **Effort:** L · **Dependencies:** None now; triggered by data volume, per `MASTER_ARCHITECTURE.md`'s performance posture note.
- **ENG-022** Add a short TTL cache (30–60s) on `buildRevenueIntelligence()`'s result — low-risk, low-effort, currently unimplemented win. — **Priority:** Low · **Effort:** S · **Dependencies:** None.
- **ENG-023** Stand up an APM/error-tracking service (Sentry or equivalent) — highest safety-per-effort item named in the original roadmap's Phase 0, still not done as of this writing. — **Priority:** High · **Effort:** S · **Dependencies:** None.

## UI/Accessibility (from `MASTER_UI.md`)

- **ENG-030** Full `aria-label` sweep on icon-only buttons across the ~35 files not yet covered (pattern already demonstrated in `kanban/page.tsx`); prioritize `inbox`, `proposals`, `reservations` next. — **Priority:** Medium · **Effort:** M · **Dependencies:** None.
- **ENG-031** Real-browser responsive/contrast/keyboard-navigation audit — never performed in any sandboxed session; needs actual browser/device access. — **Priority:** Medium · **Effort:** M · **Dependencies:** Requires a real browser/device environment (not available in sandboxed sessions).

## Consolidation debt (from `MASTER_DATABASE.md`)

- **ENG-040** Continue converging `activity_logs`/`activity_events`/`analytics_events` additively onto `activity_events` as new features are built — do not introduce a fourth overlapping table, and do not attempt a destructive consolidation migration without explicit approval. — **Priority:** Medium · **Effort:** M (ongoing, incremental) · **Dependencies:** Governed by `MASTER_DATABASE.md`'s Database Evolution Policy.
- **ENG-041** Extend `scripts/apply-v3-migrations.mjs`'s `FORWARD_FILES`/`ROLLBACK_FILES` arrays to cover migrations 014–024 (currently only covers 012–013 despite documentation elsewhere implying full coverage), or explicitly document the by-hand application procedure as the accepted approach. — **Priority:** Medium · **Effort:** S · **Dependencies:** None.

## Dead code / cleanup

- **ENG-050** Remove or repurpose the dead `/api/ai-summary` stub (`{ ok: true }`, no AI call, no DB access) — harmless as-is, real cleanup candidate. — **Priority:** Low · **Effort:** S · **Dependencies:** None.
- **ENG-051** `src/app/api/leads/import/route.ts` — switch its manual `supabase.auth.getSession()` check to the shared `requireAuth()` helper for consistency (functionally equivalent today, a style/consistency fix only). — **Priority:** Low · **Effort:** S · **Dependencies:** None.

## Process

- **ENG-060** Add `.gitattributes` for line-ending normalization to stop repo-wide CRLF diff churn. — **Priority:** Low · **Effort:** S · **Dependencies:** None.
- **ENG-061** Establish a recurring (not one-time) practice of re-verifying "presumed live" claims in `MASTER_DATABASE.md` against the actual live database at the start of any new engineering phase — the single most repeated lesson across this project's audit history. — **Priority:** High · **Effort:** S · **Dependencies:** None; underpins `MASTER_ROADMAP.md`'s Release Gates.

## Cross-reference

The growth-platform feature backlog (new modules: marketing automation, referral, loyalty, review management, etc.) lives separately in `docs/growth/21_BACKLOG.md` (`GRW-` prefix) — not duplicated here, since those are net-new features rather than debt/hardening items. Both backlogs should be reviewed together when planning any release, per `MASTER_ROADMAP.md`'s merged-phase view.
