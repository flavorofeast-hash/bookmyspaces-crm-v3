# BookMySpaces — Version 1.0 Production Readiness — Final Verification

Written 2026-08-01 on `release/v1.0.0-rc2`, HEAD `4c1ffaf`. Investigation-first, evidence-graded throughout (confirmed / presumed / unverified — never asserted as fact without a reproducible check). No features built, no architecture redesigned, no working code refactored. Where a finding was directly reproduced this session, the exact command/evidence is shown. Where this session could not independently verify something (chiefly: anything requiring live production database access), that is stated plainly rather than inferred.

---

## 1. Critical Issues

**C1 — The committed branch does not build.** Verified by cloning `release/v1.0.0-rc2` fresh (`git clone --branch release/v1.0.0-rc2`, no working-tree changes) and running `npx tsc --noEmit` and `npx next build` against that clean clone:

```
src/app/api/campaigns/track/route.ts(24,21): error TS2305: Module '"@/lib/validation"' has no exported member 'campaignTrackSchema'.
src/app/api/chat/route.ts(28,10): error TS2305: Module '"@/lib/validation"' has no exported member 'chatCampaignContextSchema'.
src/components/landing/CampaignChatLauncher.tsx(17,7): error TS2322: Property 'campaignContext' does not exist on type 'IntrinsicAttributes'.
```
`next build` on the same clean clone: **"Failed to compile"** — hard failure, not a warning. Root cause: three files needed by already-committed code (`src/lib/validation.ts`, `src/components/chatbot/ChatWidget.tsx`) were never committed — they exist only as uncommitted changes in the working directory used for this session. `POST /api/chat` (the primary website AI chat endpoint) and `POST /api/campaigns/track` both depend on the missing exports. A deploy from git alone (exactly what Vercel/CI does) fails outright. **This is the single highest-priority blocker in this report — it is not hypothetical, it was reproduced directly.**

**C2 — Migrations 012/013 (the entire Reservation Platform) confirmed NOT applied to production**, re-verified across 8+ prior sessions per `PRODUCTION_VERIFICATION_REPORT.md` (this session could not re-check directly — see C5). If still true, every reservation-creating code path (including this session's P0 pricing fix, `reservation-service.ts`, `reservation-workflow.ts`, the Reservation Dashboard) either 502s or shows an all-zero dashboard in live production today, regardless of any application-code fix.

**C3 — Migration 027 (`follow_ups` site-visit columns) never checked against production.** `scheduleSiteVisit()` performs a named-column `INSERT` (hard-fail pattern, not a degrading `SELECT *`). If 027 is not live, every AI-confirmed or manually-created site visit throws a Postgres error — this silently breaks the Site Visit → Proposal pipeline behind Journeys 1, 2, 4, and 7. Verification SQL already exists and is ready to run: `scripts/verify-migrations-026-027.sql`.

**C4 — `packages` table column-rename risk, unresolved (documented in-repo as ENG-035, same-day addendum, still open).** If the live table uses `property`/`price`/`capacity_max` instead of the migration-file names `venue`/`base_price`/`max_guests`, then `package-service.ts`'s `mapPackageRow()` silently produces `venue: undefined` and `basePrice: 0` for every package. Two independent, severe consequences if true: (a) the Skyline-never-events and Monurama-100-guest guards in `auto-package-recommendation.ts` check `if (pkg.venue && ...)` — with `venue: undefined` they **never fire**, silently disabling the exact business rules Phase 4 of this mission asks to certify; (b) every AI-drafted proposal prices at ~₹0 plus addons — a second, independent, upstream source of "revenue becomes ₹0," entirely separate from and unaddressed by this session's earlier reservation-pricing fix (that fix only corrects Proposal→Reservation pricing; this is Package→Proposal pricing). Verification SQL already exists: `scripts/verify-packages-columns.sql`.

**C5 — No live database access from this or any prior sandboxed session.** Reproduced directly this session:
```
$ node fetch test against $NEXT_PUBLIC_SUPABASE_URL/rest/v1/leads
FETCH ERROR: fetch failed
```
Consistent with the prior session's more detailed finding (`PRODUCTION_VERIFICATION_REPORT.md §0`): the sandbox's outbound proxy has a domain allowlist and `supabase.co` is not on it (`403 Forbidden`, `X-Proxy-Error: blocked-by-allowlist`) — a policy decision, not flaky connectivity. **C2, C3, and C4 cannot be resolved from any sandbox in this project's history.** They require a human with production Supabase access to run the three ready-made, read-only, `information_schema`-only SQL scripts already sitting in the repo (`scripts/verify-migrations-026-027.sql`, `scripts/verify-packages-columns.sql`, plus the existing `PRODUCTION_MIGRATION_STATE_VERIFICATION.md` §2 query for 012/013). This is the most important open action item in this entire report.

---

## 2. High Issues

**H1 — `dm-responder.ts` (Facebook Messenger / Instagram DM) does not clean the AI's raw reply.** Confirmed still present this session: `const aiReply = aiReplyRaw.trim()` — no `cleanAIResponse()` call, unlike `chat/route.ts` and (after this session's fix) the WhatsApp path. `SYSTEM_PROMPT` (channel-agnostic) can emit a `<<LEAD:...>>` tag in any reply; if it does, on Facebook/Instagram that raw tag text would be sent directly to the customer. Real, live, reproducible risk — not yet fixed (tracked as task #72 from this session, still pending).

**H2 — This session's WhatsApp default-path fix is implemented but uncommitted.** `src/app/api/whatsapp/webhook/route.ts` now correctly uses `chatWithAI()` + `captureLeadWithJourney()` + `checkAndApplyHandoff()` instead of the old hardcoded keyword-matcher — verified via `tsc`/`vitest` against the working tree — but this change exists only in the working directory, not in git history. If this working copy is ever lost or reset, the live default WhatsApp path reverts to the old behavior (no AI, no lead auto-creation, no escalation).

**H3 — Migrations 016/017/024 confirmed missing, each with a named, specific, silent (non-crashing) failure mode**, carried forward from `PRODUCTION_VERIFICATION_REPORT.md` (not re-derived): 016 → standalone proposals get `lead_id = NULL` (partially mitigated at the application layer this session's history shows, via `ensureLeadForProposal()`, but the migration itself is still unapplied); 017 → Excel Lead Import silently writes zero leads; 024 → AI interaction logging for two action types is silently swallowed.

**H4 — Granular hall/rooftop capacity rules are not code-enforced.** Verified: `auto-package-recommendation.ts` hard-blocks two rules only — Skyline is never assigned to an event proposal, and Monurama's total guest count never exceeds 100. The specific per-venue numbers the mission asks to certify (Rooftop 40–50, Hall 1 = 15, Hall 2 = 15) exist only as marketing FAQ copy (`campaign-config.ts`) and as a *soft instruction* inside the AI's `SYSTEM_PROMPT` ("Guest count 40–50: recommend the Rooftop... 15 or fewer: recommend a Hall") — advisory to the AI, not a guard that blocks an operator or a misfiring AI from creating a 45-guest proposal against Hall 1. This is a real gap between the mission's stated business rule and what the Proposal Engine actually enforces in code.

**H5 — `release/v1.0.0-rc2` is 16 commits ahead of `origin/release/v1.0.0-rc2`.** Unpushed. Combined with H2 and the uncommitted-but-load-bearing files in C1, a meaningful amount of working, verified code exists only in this one working directory.

---

## 3. Medium Issues

**M1 — Valuable prior audit work sits untracked, never committed:** `RC1_DEPLOYMENT_READINESS.md`, `audit/MIGRATION_023_DEPLOYMENT_REVIEW.md`, `audit/MIGRATION_024_DEPLOYMENT_REVIEW.md`, `audit/PRODUCTION_MIGRATION_STATE_VERIFICATION.md`, `scripts/verify-migration-023.sql`, `scripts/verify-migrations-012-013-016-017-024.sql`, `docs/growth/`, `supabase/seed/rc1_catalog_test_seed.sql`. This includes the exact verification scripts C2–C4 depend on — at risk of loss, and invisible to anyone reviewing git history alone.

**M2 — Branch clutter.** 9+ stale/backup local branches (`backup-before-route-fix`, `backup-before-supabase-refactor`, `backup-before-whatsapp-merge`, `feature/v3-omnichannel-platform`, `fix/customer-proposal-sync`, `phase6-excel-import`, `production-stable-v1`, `recovery-whatsapp`, `remediation/phase-0-audit-followup`, `stable-phase1`), and local `main` itself is 7 commits ahead of `origin/main` — a confusing state for anyone else who touches this repo. Recommend pruning merged/obsolete branches and reconciling `main` before go-live, not as a blocker but as hygiene.

**M3 — RLS gaps on `analytics_events` and `follow_ups`**: RLS enabled, zero policies (effectively deny-all except `service_role`). Not currently exploitable — every server-side function in this codebase uses the service-role client — but a latent gap the moment any client-side/session-scoped query is added against either table.

**M4 — Bounded-scan dedup fallback.** `chat/route.ts`'s `upsertLead()` falls back to scanning up to 500 lead rows into memory when the fast indexed phone match misses (self-disclosed in its own comment as a "legacy-data safety net" for pre-canonicalization phone formats). Not a current problem at today's volume; worth watching as lead volume grows.

## 4. Low Issues

**L1 —** Pre-existing ESLint warning, cosmetic only: `<img>` in `src/components/auth/UserMenu.tsx` (LCP/bandwidth suggestion, not an error).

**L2 —** `PRODUCTION_VERIFICATION_REPORT.md`'s own internal grading of the `packages` table was self-corrected mid-document by its own dated addendum (Yellow → Critical) — a documentation nit already resolved by the document itself, noted here only for completeness.

---

## 5. Production Blockers (must resolve before Version 1.0 ships)

1. **C1** — Commit `src/lib/validation.ts` and `src/components/chatbot/ChatWidget.tsx` (the two files whose absence breaks the committed build). These are on this project's own "off-limits, do not touch" list from earlier in this session — a human decision is needed on whether to commit them as-is or reconcile them differently; either way, **the committed branch cannot ship in its current state.**
2. **C2, C3, C4** — Run the three ready-made verification SQL scripts against production (see §1) before trusting the Reservation Platform, Site Visit scheduling, or Property Intelligence guards / proposal pricing in production. This is a ~15-minute task for anyone with Supabase SQL Editor access; it cannot be done from any AI sandbox in this project's history.
3. **H1** — Add `cleanAIResponse()` to `dm-responder.ts` before Facebook/Instagram DM is trusted with real customers (small, isolated fix, no redesign).
4. **H2, H5** — Commit the uncommitted WhatsApp fix and push `release/v1.0.0-rc2` to origin.

## 6. Recommended Fixes (small, scoped, no redesign)

- Commit or explicitly reconcile the three off-limits files (C1) — this alone unblocks the build.
- One-line fix in `dm-responder.ts`: wrap the AI reply in `cleanAIResponse()` (H1) — exact same pattern already used in `chat/route.ts` and the WhatsApp path.
- Commit `src/app/api/whatsapp/webhook/route.ts` (H2) and push the branch (H5).
- Run the three verification SQL scripts (C2–C4) and apply the paired, already-written, idempotent migration files only if a script reports FAIL.
- Optionally: add a hard per-hall/rooftop guest-count guard alongside the existing Skyline/Monurama-100 guard in `auto-package-recommendation.ts` (H4) — small, additive, same pattern as the existing guard, not a redesign.
- Repo hygiene (M1, M2): commit or delete the untracked audit docs/scripts; prune merged backup branches.

## 7. Repository Health

Git: on `release/v1.0.0-rc2` (`4c1ffaf`), 16 commits ahead of origin, unpushed. Working tree has 6 modified files (2 tooling/session config, irrelevant; 1 load-bearing uncommitted feature fix (WhatsApp, H2); 3 off-limits files whose absence causes C1) and 9 untracked paths (M1). 44 migration files (27 real + 17 paired rollbacks), sequential 001–027, no gaps, no deprecated markers. No secrets committed (`.gitignore` correctly covers all `.env*` variants; no hardcoded key patterns found in `src`). One dead-code path already known and confirmed inert this session (`src/services/whatsapp/process-inbound.ts`, imports from an off-limits file but is never imported by any live route). 9+ stale local branches (M2).

## 8. Database Health

27 real migrations on disk, evidence-graded per `PRODUCTION_VERIFICATION_REPORT.md` (fully cited, not re-derived, since this session independently re-confirmed the same connectivity block that document already documented): confirmed applied 001–003, 005–010; **confirmed NOT applied 012/013** (C2); confirmed missing with named symptoms 016/017/024 (H3); unverified 011, 014, 015, 018–023, 025, 026; **never checked** 027 (C3); **critical unresolved column-drift risk** on `packages` (C4). Live snapshot evidence is a single 2026-07-11 pasted-back query, now three weeks stale relative to today. No session in this project's history has ever had live Supabase access from its sandbox (C5, independently reconfirmed today).

## 9. Customer Journey Results (code-path verified — no live browser/DB execution was possible this session; see C5)

| Journey | Code path exists & wired | Notes |
|---|---|---|
| 1. Website Chat → Lead → Proposal → Booking | Yes | `chat/route.ts` confirmed compliant this session (chatWithAI, dedup, timeline sync, escalation). Booking step depends on C2 (reservations table live). |
| 2. WhatsApp → Lead → Proposal → Booking | Yes, as of this session's uncommitted fix (H2) | Prior to this session's fix, the live default path used a keyword-matcher with no lead auto-creation — now fixed but uncommitted. |
| 3. Facebook Messenger → Lead → Proposal → Booking | Yes, with a live bug | Confirmed compliant except H1 (tag-leak risk). |
| 4. Instagram → Lead → Proposal → Booking | Yes, same path as Facebook (Meta unified adapter) | Same H1 caveat. |
| 5. Airport Stay | Presumed — no dedicated code path found; treated as a Skyline Serenity room booking (accommodation-only). No journey-specific gap found beyond the general reservation-pricing (C2) and business-rule (C4) risks. |
| 6. Wedding | Yes — Monurama event package flow, subject to H4 (soft-only hall/guest-count enforcement) and C4 (package pricing risk). |
| 7. Birthday | Yes — same package flow as Wedding; also depends on C3 (site visit) if a visit is scheduled first. |
| 8. Corporate Event | Yes — same package flow; Hall 1/Hall 2 sizing is exactly where H4 matters most. |
| 9. Returning Customer | Yes — `resolveIdentity()` (phone/email match against `leads`) is the cross-channel mechanism; confirmed this session (Version 3.1 investigation) to correctly prevent duplicate customer/lead creation across every channel. |
| 10. Human Escalation | Yes, with one gap now fixed and one still open | `checkAndApplyHandoff()` is the single shared escalation policy; confirmed used by website chat and Facebook/Instagram; now also wired into WhatsApp's default path this session (H2, uncommitted). |

Every journey verified this session was verified via unit/integration tests and direct code reading (517/517 tests passing against the working tree), **never via an actual live browser session against a live database** — no session in this project's history has had that capability. This is a real, disclosed gap for a "customer can complete this journey" certification.

## 10. Final Readiness Score

| Category | Score | Basis |
|---|---|---|
| Repository Health | 45/100 | Confirmed broken build at the committed ref (C1); real, else-solid git discipline |
| Database | 35/100 | Two confirmed-critical, two unresolved-critical DB-state unknowns; zero live verification possible |
| Security | 78/100 | Broad auth coverage, webhook signature verification, cron secret, no leaked secrets; RLS policy gaps (M3) |
| Performance | 70/100 | No load testing performed (no live env available); code patterns reasonable; one watch-item (M4) |
| Business Rules | 55/100 | Property-wide rules hard-enforced; granular hall/rooftop caps soft-only (H4); contingent on C4 |
| AI | 65/100 | Single-consultant architecture genuinely sound and well-tested; two concrete live gaps (H1, H2) |
| CRM | 72/100 | Timeline/identity/escalation well-designed and tested; downstream of DB unknowns |
| Dashboards | 75/100 | Real computed values, no fabrication, extensively unit-tested; downstream of DB unknowns |
| Testing | 60/100 | 517/517 unit/integration tests passing; zero live/E2E verification ever performed on this project |
| Deployment | 30/100 | Unpushed commits, broken build at the actual deployable ref, no CI evidence reviewed |
| **Overall Readiness** | **52/100** | Weighted toward the confirmed blockers (build failure, unresolved DB-state criticals) |

## 11. Recommendation

**NOT READY FOR PRODUCTION.**

This is not a judgment on the quality of the application logic — the AI architecture, CRM design, dashboard computations, and this session's own P0 pricing fix are all genuinely sound and well-tested. The recommendation is driven entirely by confirmed, reproducible blockers: the committed branch does not build (C1, directly reproduced), and the single feature this mission asked to certify as safe — the Reservation Platform and its pricing — sits on top of at least two unresolved, previously-flagged, still-open critical database-state unknowns (C2, C4) that no sandbox in this project has ever been able to check. Every one of these blockers has a small, already-identified, already-scoped fix (§6) — none require new features or a redesign. Once C1 is committed, C2–C4 are resolved by a human running three existing SQL scripts, and H1/H2/H5 are closed, this platform is in a strong position to re-certify quickly.
