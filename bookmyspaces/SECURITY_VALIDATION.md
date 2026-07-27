# SECURITY_VALIDATION.md — Go-Live Prep, Phase 6

Date: 2026-07-27. Re-verification of `SECURITY_REVIEW.md` (RC pass) rather than a full re-audit from scratch — every fix that pass claimed was re-checked directly against the current file contents this session, and one real inaccuracy in that document was found and corrected in the process (see below). This is the "assume nothing" instruction applied literally: even this pass's own prior output was checked, not trusted.

## Authentication — re-verified

Fresh sweep this session: 68 total API routes, 51 call `requireAuth()`/`requireRole()`. The 17 that don't were individually re-identified (not just counted) and every one matches a documented, deliberate category: auth flow itself (`callback`, `logout`), public-by-design customer/webhook routes (chat, proposal share/pdf/preview/track-view, WhatsApp + social webhooks), cron routes (protected by `CRON_SECRET` instead), the health check, the dead `ai-summary` stub, and two routes (`leads/import`, `notifications`) that check the session manually via `getSession()`/`getCurrentUser()` rather than the shared helper — re-confirmed present in both files this session, not regressed. **No new or unexplained unauthenticated route found.**

## RC-pass fixes — re-verified still present in code

All three checked by direct grep this session, not assumed from the prior report:

- WhatsApp webhook rate limiting: `checkRateLimit` call present in `src/app/api/whatsapp/webhook/route.ts:53`. ✅
- Proposal PDF XSS fix: `escapeHtml(r.room_type)` and `escapeHtml(a.name)` both present in `src/lib/proposal-pdf.ts`. ✅
- Filter-injection sanitization: the `[,()]` stripping pattern present in both `src/lib/ai.ts` and `src/app/api/leads/route.ts`. ✅

None of these were lost or reverted between the RC pass and this session, despite there being no git history to formally guarantee that (see `REPOSITORY_VALIDATION.md`) — direct file inspection is the only way to know that in this environment, so it was done rather than assumed.

## Correction found this phase

`SECURITY_REVIEW.md`'s webhook verification summary previously claimed both the WhatsApp and Social webhooks "fail open" if their signing secret is unset. Re-reading `src/lib/social/adapters/meta-adapter.ts` directly this phase found that claim wrong for Social: `verifyWebhook()` returns `false` (and the route responds 401) when `META_APP_SECRET` is missing — Social **fails closed**, only WhatsApp fails open. `SECURITY_REVIEW.md` has been corrected in place with this finding. This matters for prioritization: WhatsApp's missing secret (confirmed absent in both env snapshots, see `ENVIRONMENT_VALIDATION.md`) is a live risk; Social's missing secrets are not, they just mean that channel stays inactive.

## Rate limiting — re-verified

`checkRateLimit` (`src/lib/rate-limit.ts`) confirmed present and correctly invoked on: `/api/chat` (20/min/IP), `/api/whatsapp/webhook` (120/min/IP), `/api/social/webhook/[platform]` (120/min/IP). No other public route needs it — the remaining public routes (proposal share/pdf/preview) are read-only GETs gated by an unguessable token, not susceptible to the same abuse pattern rate limiting defends against.

## RLS — cannot be re-verified live, documented limitation carried forward

No live database access this session (`DATABASE_VALIDATION.md`), so live RLS policy state cannot be directly queried. What's carried forward from `audit/ENGINEERING_WORKSPACE_CURRENT_STATE.md` (2026-07-26) is architecturally significant enough to restate here rather than just link: **most `authenticated`-role RLS policies in this database are unscoped (`USING (true)`)** — authorization is enforced at the API layer (`requireAuth()`/`requireRole()`), not by RLS row-scoping. This is confirmed as a deliberate, consistent choice (migration 012's newer tables continue it with `service_role`-only policies), not drift. **Practical consequence for go-live: RLS is not a safety net here.** The Authentication section above (51/68 routes correctly gated) is doing the actual access-control work, not the database. This makes the "no new unauthenticated route" finding above more load-bearing than it would be in an RLS-enforced architecture — worth flagging prominently for whoever reviews future route additions.

## Secret handling — re-verified

- No hardcoded secrets found in `src` (re-grepped this session for `sk-`/`service_role` literal patterns — zero matches, same as RC pass).
- `.gitignore` confirmed to exclude `.env`, `.env.local`, `.env.*.local`, and the specific `.env.local.20260603.backup` file by name — all three real secret-bearing files present in this working folder are correctly excluded from any future commit.
- **New finding this phase, relevant to secret handling**: `WHATSAPP_APP_SECRET` and `CRON_SECRET` are confirmed absent from both the local dev env and a production Vercel snapshot — see `ENVIRONMENT_VALIDATION.md` for full detail. This is an environment-configuration gap, not a code-level secret-handling defect, but it's the most security-relevant finding of this entire Go-Live pass and is called out again here for visibility.

## Summary

| Area | Status |
|---|---|
| Authentication (route coverage) | PASS — re-verified, no new gaps |
| RC-pass security fixes | PASS — all 3 confirmed still present |
| Webhook verification | PASS, with 1 correction (Social fails closed, not open as previously stated) |
| Rate limiting | PASS — re-verified on all 3 relevant routes |
| RLS | NOT VERIFIED (no live DB access) — architecture relies on API-layer auth, not RLS, by design |
| Secret handling (source + gitignore) | PASS |
| Secret handling (production env vars) | **FAIL** — `WHATSAPP_APP_SECRET`, `CRON_SECRET` confirmed missing, see `ENVIRONMENT_VALIDATION.md` |
