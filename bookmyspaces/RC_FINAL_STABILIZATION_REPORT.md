# BookMySpaces — Version 1.0 RC-Final — Release Stabilization Sprint

Written 2026-08-01 on `release/v1.0.0-rc2`, HEAD `2e7c701`. Three commits landed this sprint, in order: `70d75c9` (the build fix), `97fb353` (WhatsApp fix, already-verified from earlier this session, previously uncommitted), `2e7c701` (docs/SQL-scripts-only, no application code). Scope: repository stabilization only, per this sprint's explicit mandate — no features, no architecture changes, no UI/database redesign.

---

## 1. Root Cause of the Build Mismatch

**Category: files modified but not committed** (confirmed, not guessed — reproduced twice from two independent, fully clean `git clone --branch release/v1.0.0-rc2` checkouts, byte-identical error both times before the fix, zero errors after):

```
src/app/api/campaigns/track/route.ts(24,21): error TS2305: Module '"@/lib/validation"' has no exported member 'campaignTrackSchema'.
src/app/api/chat/route.ts(28,10): error TS2305: Module '"@/lib/validation"' has no exported member 'chatCampaignContextSchema'.
src/components/landing/CampaignChatLauncher.tsx(17,7): error TS2322: Property 'campaignContext' does not exist on type 'IntrinsicAttributes'.
```

A prior session implemented the Sprint 1 "Campaign Landing Page System" across five files. Three of them — `src/app/api/chat/route.ts`, `src/app/api/campaigns/track/route.ts`, `src/components/landing/CampaignChatLauncher.tsx` — were committed and already reference `campaignTrackSchema`/`chatCampaignContextSchema` (exported from `src/lib/validation.ts`) and a `campaignContext`/`initialOpen` prop pair (on `src/components/chatbot/ChatWidget.tsx`). The other two files — the ones that actually *define* those exports/props — were never committed. Every session's local working tree still had those two files' edits sitting on disk, uncommitted, which is exactly why `tsc`/`next build` always passed *in that tree* and why this went unnoticed across many prior sessions: the working tree was never actually equivalent to what `git log` contained.

Ruled out, with evidence: not a merge conflict (no conflict markers, no merge commits nearby); not branch divergence (identical failure on a fresh single-branch clone with no other branches involved); not incorrect imports (the three consumer files import the right names — the exporters were simply incomplete at HEAD); not build-cache dependence (reproduced from a cache-free clone, `.next` never existed); not a generated-file dependency (nothing in the missing content is generated).

## 2. Files Changed

- `src/lib/validation.ts` — committed as-is (no content changes made by this sprint), adds `campaignTrackSchema` and `chatCampaignContextSchema`.
- `src/components/chatbot/ChatWidget.tsx` — committed as-is (no content changes made by this sprint), adds the optional `campaignContext`/`initialOpen` props and a `bms:open-chat` window-event listener; the default export remains callable with zero arguments, so every other existing usage is unaffected.
- Separately, also committed this sprint (verified, previously-uncommitted from earlier in this engagement, in scope per this sprint's "nothing important exists only in the working tree" mandate): `src/app/api/whatsapp/webhook/route.ts` (WhatsApp default-path AI fix) and a docs/SQL-scripts-only commit (see §8).

No other files were edited. No business logic was touched in either fix commit.

## 3. Why the Working Tree Succeeded

The working tree used across this entire multi-session engagement always had the uncommitted edits to `validation.ts` and `ChatWidget.tsx` physically present on disk. `tsc`/`vitest`/`next build` all read from disk, not from git — they had no way to know those two files' content had never been `git add`-ed. Every "clean build" claim made in prior sessions (including earlier this session) was true *of the working tree*, and simply never implied anything about what a fresh clone would see.

## 4. Why Git Checkout Failed

A `git clone` (or any deploy pipeline pulling from git, e.g. Vercel) only ever sees committed content. At the commit prior to this sprint's fix, `validation.ts` and `ChatWidget.tsx` did not contain the exports/props that three other, already-committed files depend on — so `tsc` and `next build` both fail immediately on missing-member/prop-type errors. This is the exact scenario Priority 1 of this sprint's mission described as the example category "files modified but not committed," confirmed as the actual cause, not a guess.

## 5. Exact Fix

Smallest possible change: `git add` and commit the existing, unmodified content of the two missing files. No lines were rewritten, no logic changed, no new code introduced beyond what was already sitting in the working tree and had already been passing `tsc`/`vitest`/`next build` all session. Commit `70d75c9`.

## 6. Tests Executed

- `npx tsc --noEmit -p tsconfig.json` — clean, on a fresh clone of the post-fix HEAD (reproduced twice).
- `npx vitest run` — **517/517 tests passing, 55 files**, on the same fresh clone.
- `npx next build` — compile + typecheck/lint phase clean on the fresh clone (only the pre-existing, unrelated `<img>` ESLint warning in `UserMenu.tsx`); static-page-generation (37 pages) did not complete within this sandbox's ~45-second per-command cap on the fresh-clone attempts this sprint (4 attempts, each stalling at the same "Generating static pages (0/37)" point) — this is the same previously-documented, cross-session sandbox constraint (`ENG-005`, `RELEASE_REPORT.md`: "npm run build has never been confirmed to complete successfully in any sandbox session... diagnosed as environmental"). A full, clean 37/37 static-generation completion **was** captured earlier this session against the working tree (same code, prior to this sprint's fix — the fix is additive-only and touches no page component), so the code itself is not in question; only this sandbox's ability to finish a cold-cache build within its timeout is.

## 7. Build Verification

Fresh `git clone --branch release/v1.0.0-rc2` (no working-tree state carried over) → `tsc` clean → `vitest` 517/517 → `next build` compiles and typechecks clean, static-generation phase bounded by the sandbox's timeout as described in §6, not by a code defect (confirmed once, full 37/37, earlier this session on equivalent code). **This is a materially different and better result than the pre-fix state, where the fresh clone failed outright at the typecheck stage** — the remaining gap is a sandbox limitation, not a build failure.

## 8. Repository Hygiene (Priority 2) and Release Validation (Priority 3)

- `git status --short` on the working tree is now clean except: `src/lib/whatsapp/auto-responder.test.ts` (deliberately left uncommitted — an off-limits file per this project's standing instruction; independently confirmed its absence is non-blocking, since the committed HEAD version's 16 tests already pass against the committed `auto-responder.ts`), and two tooling/session config files (`.claude/settings.local.json`, `.mcp.json`) which are not application code and are out of scope for repository release-readiness.
- Also committed this sprint (docs/SQL-only, no application code, no SQL content modified): `RC1_DEPLOYMENT_READINESS.md`, `VERSION_1_0_PRODUCTION_READINESS.md`, three `audit/` migration-review documents, `docs/growth/01–21` (growth-strategy planning docs), two verification SQL scripts, and one seed file — all of these previously existed only in the working tree and are now part of git history.
- Migrations: 27 real migration files, sequential `001`–`027`, each with a paired `_ROLLBACK.sql`, no gaps, no deprecated markers — unchanged from the prior readiness pass, re-confirmed.
- No secrets committed; `.gitignore` correctly covers every `.env*` variant; no hardcoded key patterns found in `src`.
- One already-known, confirmed-inert dead file (`src/services/whatsapp/process-inbound.ts`) — imports from an off-limits file but is never imported by any live route; left untouched, unchanged from before.
- Branch clutter (9+ stale local branches, local `main` 7 commits ahead of `origin/main`) — unchanged from the prior readiness pass; not touched this sprint (out of scope — deleting branches is a judgment call for a human, not appropriate for an automated "smallest possible change" sprint).
- Branch state: `release/v1.0.0-rc2` is now **19 commits ahead of `origin/release/v1.0.0-rc2`** (was 16 before this sprint's 3 new commits) — still unpushed. Pushing requires credentials/access this sandbox does not have; flagged as the top remaining action item.

## 9. Database Readiness (Priority 4) — Existing Verification Scripts, Not Modified

Five read-only, `information_schema`-only verification scripts already exist in `scripts/`. None were modified; no new ones were written (none were "absolutely required" — existing coverage is sufficient). Recommended execution order against production, before deploy:

1. **`scripts/verify-packages-columns.sql`** — highest priority. Resolves whether `packages.venue`/`base_price`/`max_guests` exist live or were silently renamed to `property`/`price`/`capacity_max`. If renamed: the Skyline/Monurama business-rule guards silently never fire, and every AI-drafted proposal prices near ₹0 — both a business-rule and revenue-critical finding.
2. **`scripts/verify-migrations-026-027.sql`** — resolves whether `follow_ups`' site-visit columns (migration 027) are live. If not: every site-visit request (AI-confirmed or manual) hard-fails with a Postgres error.
3. **`scripts/verify-migrations-012-013-016-017-024.sql`** — resolves the Reservation Platform's live status (012/013) plus three more migrations with named silent-failure modes (016, 017, 024).
4. **`scripts/verify-migration-023.sql`** — narrower, package/event-management-specific follow-up to #1/#3.
5. **`scripts/verify-notifications-columns.sql`** — lower priority; confirms the `notifications` table's real column set before trusting Chief of Staff notification writes.

None of these can be executed from any AI sandbox in this project's history — the outbound proxy blocks `supabase.co` (confirmed again this session: `fetch failed`, consistent with the prior session's `403 Forbidden / blocked-by-allowlist` finding). This requires a human with production Supabase SQL Editor access; each script is a single paste-and-run, ~2–3 minutes total for all five.

## 10. Remaining Production Blockers

1. **Push `release/v1.0.0-rc2` to origin** (19 commits, unpushed) — needs real git credentials/access this sandbox doesn't have.
2. **Run the five verification SQL scripts** (§9) against production and apply the paired, already-written, idempotent migration files only if a script reports FAIL.
3. **`dm-responder.ts` (Facebook/Instagram DM) still lacks `cleanAIResponse()`** — confirmed still present this sprint, unchanged from the prior readiness pass. A real, live, small, isolated fix, not touched this sprint since this sprint's mandate was build/repo stabilization specifically, not further feature/bug work — flagged, not fixed, here.
4. Everything else already identified in `VERSION_1_0_PRODUCTION_READINESS.md` and unaffected by this sprint (branch clutter, RLS policy gaps, granular hall-capacity soft-enforcement) still stands, graded there.

## 11. Updated Readiness Score

| Category | Prior score | New score | Why it moved |
|---|---|---|---|
| Repository Health | 45/100 | **80/100** | The confirmed build-breaking gap is fixed and reproducibly verified; branch clutter and unpushed commits remain, capping the score short of higher |
| Deployment | 30/100 | **50/100** | Fresh-clone build now succeeds through typecheck/lint (previously failed outright); still blocked on push-to-origin (needs real git access) and the DB verification scripts |
| Database | 35/100 | 35/100 | Unchanged — still zero live verification possible from any sandbox; same five scripts still need a human to run them |
| Security | 78/100 | 78/100 | Unchanged, not in this sprint's scope |
| Performance | 70/100 | 70/100 | Unchanged, not in this sprint's scope |
| Business Rules | 55/100 | 55/100 | Unchanged, not in this sprint's scope |
| AI | 65/100 | 65/100 | Unchanged this sprint at the scoring level, though `dm-responder.ts`'s gap (§10.3) is now the single most concrete remaining AI item |
| CRM | 72/100 | 72/100 | Unchanged, not in this sprint's scope |
| Dashboards | 75/100 | 75/100 | Unchanged, not in this sprint's scope |
| Testing | 60/100 | **65/100** | 517/517 now independently reconfirmed against a truly fresh clone (not just the working tree) — closes part of the "was this ever really tested against what's in git" gap |
| **Overall Readiness** | **52/100** | **63/100** | Driven by the two hardest blockers this sprint could actually resolve from a sandbox: the build now works from a clean clone, and every consequential piece of work from this engagement is now in git history |

## 12. Recommendation

**NOT READY FOR RC FINAL — but the gap remaining is now entirely outside what any AI sandbox can close, not an unresolved code defect.**

The repository can now be cloned, installed, typechecked, tested, and built through compile/lint by anyone — the specific failure this sprint was created to fix is fixed and independently reproduced as fixed. What remains is exactly two categories of work, both requiring infrastructure access this sandbox does not have: (1) push this branch to `origin` so the fix actually reaches anywhere deployable, and (2) run five short, already-written, read-only SQL scripts against the real production database to resolve whether the Reservation Platform, Site Visit scheduling, and Property Intelligence guards are safe to rely on. Once those two steps are done by someone with real git and Supabase access — realistically a single short session — this release is in a strong position to re-certify as ready.
