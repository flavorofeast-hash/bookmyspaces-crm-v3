# PROJECT_STATUS.md — BookMySpaces CRM V3

Generated: 2026-08-13 (NIGHT SHIFT pass). HEAD at time of writing: `a601d97`.

**Read this first:** this session has no push access to GitHub (`git push origin main` fails 403 — "not in this session's authorized repository set"), no Vercel dashboard/API/CLI access, and no network path to the live Supabase database. Every fix below is a **local commit in this sandbox** — nothing has reached GitHub, Vercel, or production yet. See NEXT_STEPS.md item 1.

## Production readiness: ~85%

Code is in good shape (clean build, clean lint, clean typecheck, 417/417 tests). The remaining 15% is entirely external configuration and manual deployment/DB steps — no known code work is blocking.

## Infrastructure

- Next.js 14 App Router, Supabase Postgres, Vercel hosting (region `bom1`), Anthropic Claude (primary AI) + OpenAI (embeddings/fallback).
- `npm install`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (417/417 passed), `npm run build` all clean as of `a601d97`.

## Deployment

**Known issue, root-caused, not resolved (requires manual Vercel dashboard action):** Vercel has been deploying commit `3ff8ca5` instead of HEAD regardless of pushes/redeploys. Root cause: `3ff8ca5` is a parentless root commit (`git show -s --format="%P" 3ff8ca5` → empty; 442 files, 89720 insertions) — a full history rewrite/force-push, a known way to desync the GitHub↔Vercel webhook binding. Full evidence and a decision tree for the exact dashboard fix are in `ROOT_CAUSE.md`. **This cannot be fixed from this session — no Vercel access.**

## Database

27 migrations (`001`–`027`), additive/idempotent convention throughout. This session added:
- **026** — extends `leads.source` CHECK constraint with 4 Meta capture values (see CRM/Meta sections below). **Not yet applied to any live database.**
- **027** — adds 18 missing indexes on foreign-key columns, verified by reading every migration's `REFERENCES` and `CREATE INDEX` statements in full (agent-verified, see commit `0eb4407` for the complete checked/added list). Purely additive, safe. **Not yet applied to any live database.**

**Documented drift, not auto-fixed (per instruction: document unsafe items, don't guess):**
- `leads.lead_stage` and a `notifications` table exist and are actively used live (`active_users_view`, `proposal_intelligence_view` both reference `lead_stage`) but are created by no migration — pre-existing drift, already documented in `audit/SCHEMA_DRIFT_REPORT.md`. Live app is unaffected; a backfill migration should be written once someone can confirm the exact live DDL (this session can't query the live DB to generate it safely).
- `activity_logs` and `knowledge_chunks`: migrations `001`/`002`/`007`/`012` enable RLS on these tables, but `audit/LIVE_SCHEMA_AUDIT.md` reports RLS is live-disabled on both. Could be intentional (manually disabled to fix an incident) or drift — needs a decision, not a blind re-enable.
- RLS policies on `campaigns`, `invoices`, `lead_imports`, `leads`, `payments` are unscoped (`USING (true)` for the `authenticated` role) — any logged-in staff account can read/write any row via a direct DB client. This is a **documented, deliberate architectural choice** (`SECURITY_REVIEW.md`: authorization is enforced at the API layer via `requireAuth()`/`requireRole()`, not RLS row-scoping) — not a regression, but worth knowing the security model depends on every API route remembering to call the auth guard.

## API

- Fixed this pass: 4 cron routes (`followups`, `escalations`, `campaign-queue`, `stay-lifecycle`) previously failed **open** (zero auth) if `CRON_SECRET` was unset — now fail closed (500, refuses) and log via `logger.error`. **Requires `CRON_SECRET` to be set in Vercel for cron to function at all going forward** — it was already a documented must-set item, this just makes the code enforce it instead of silently degrading.
- Fixed: `proposals/[id]/payment` accepted non-numeric amounts (`NaN` reached the DB insert) — now uses `Number.isFinite()`.
- Fixed: `admin/users` PATCH/POST accepted any string as a role with no app-level check (DB CHECK already blocked it, but via a raw Postgres error) — now validated against the same 4 roles as migration 009's CHECK.
- Fixed: `proposals/[id]/receipt` interpolated proposal/payment fields into raw HTML unescaped (its sibling `invoice` route already had this fix) — now escaped consistently.
- **Correction made and reverted this pass:** an initial fix added `requireAuth()` to `proposals/[id]/pdf` and `/preview`, based on an audit finding that didn't cross-check `SECURITY_REVIEW.md` finding #7. Both routes are **intentionally public** — the anonymous customer share page links directly to `/api/proposals/${id}/pdf`, and `/preview`'s `sent`→`viewed` status flip is the proposal-view-tracking feature for that same anonymous flow. Reverted (commit `ce36270`) before it could reach a deploy.
- Remaining findings from this pass's API audit not yet acted on (documented, not fixed, given the false-positive above — each needs the same cross-check against `SECURITY_REVIEW.md`/`API_SPECIFICATION.md` before touching): mass-assignment risk on `proposals`/`campaigns` PATCH (no field allowlist), missing rate limiting on 2 public-facing routes, inconsistent error response shapes/status codes across some routes, minor auth-helper inconsistency in `leads/import`, missing UUID pre-validation in 2 routes, a dead stub route (`ai-summary`, already flagged as harmless in `SECURITY_REVIEW.md` finding #8).

## Authentication

Supabase Auth (session cookies via `@supabase/ssr`). `requireAuth()`/`requireRole()` (`src/lib/auth-guard.ts`) gate every CRM-facing route. See `SECURITY_REVIEW.md` for the full audit of which routes are public-by-design and why.

## CRM

Core lead/proposal/reservation/invoice/payment flows unchanged this pass except the fixes above. No new features added, per instruction.

## WhatsApp

Meta Cloud API is the live send/receive path (Wati.io is legacy, used only by `/api/health` and a transcription helper). `WHATSAPP_APP_SECRET` unset means webhook signature verification fails **open** (logs a warning, still accepts) — pre-existing, documented in `SECURITY_REVIEW.md` finding #2, not touched this pass. Must-set for production.

## Facebook / Instagram (Meta)

Graph API v23.0 integration. Fixed prior turn: Facebook post publishing branches `/photos` (with media) vs `/feed` (text-only); Instagram always uses the mandatory two-step `/media` → `/media_publish` flow and rejects text-only posts with a clear error instead of a Graph API failure.

**Found and fixed this pass — was a 100%-silent-failure bug:** every Meta Lead Ads submission, Messenger message, and Instagram DM was being captured and parsed correctly, then failing to insert into `leads` with a Postgres CHECK violation (`leads_source_check` didn't allow `facebook_lead_ads`/`instagram_lead_ads`/`facebook_messenger`/`instagram_dm`). The webhook still returned 200; the failure was only visible in server logs. Fixed by migration 026 — **not yet applied to any live database**, see NEXT_STEPS.md.

`publishPost()` is correct and callable but no code path invokes it automatically yet — Content Studio only creates draft/scheduled rows, there's no "Publish Now" trigger or scheduler. Intentionally not built this pass (no new features unless required) — see `META_SETUP.md`'s Known Limitation section.

Full Meta go-live checklist (App setup, permissions, env vars, testing steps): `META_SETUP.md`.

## Testing

44 test files, 417 tests, all passing. Added this pass: 13 tests for `meta-lead-capture.ts` (leadgen/messaging event parsing, Graph API detail fetch), 4 tests for `dm-capture-service.ts` (new-lead creation, existing-lead re-qualification, source mapping, never-throws contract).

## Security

See `SECURITY_REVIEW.md` for the full prior audit (public-route inventory, webhook fail-open/closed behavior, injection findings, XSS findings — all previously fixed). This pass's additions: cron fail-closed fix, receipt-route HTML escaping, payment NaN-guard, admin role validation. This pass's near-miss (caught before commit could reach a deploy): almost broke the intentionally-public pdf/preview routes — see API section above.

## Remaining manual tasks (cannot be done from this session)

1. **Push these commits to GitHub** — no push access from this sandbox (403). See NEXT_STEPS.md for exact commit range and file-by-file content if a manual patch is needed.
2. **Fix the Vercel deployment pinning** — see `ROOT_CAUSE.md` for the exact dashboard steps (branch depends on what the Deployments tab shows).
3. **Apply migrations 026 and 027 to the live Supabase database** — no DB network access from this sandbox.
4. **Set `CRON_SECRET` in Vercel** before/at deploy — cron routes now fail closed without it (this is a behavior change from this pass; previously they ran unauthenticated instead).
5. **Set the 5 `META_*` env vars in Vercel** and complete the Meta Developer Console setup — see `META_SETUP.md`.
6. **Set `WHATSAPP_APP_SECRET`** to close the WhatsApp webhook fail-open gap (`SECURITY_REVIEW.md` finding #2).
7. **Decide on the DB drift items** (`lead_stage`/`notifications` backfill migration, `activity_logs`/`knowledge_chunks` RLS) — needs a human decision, not a blind fix.

## Tomorrow morning checklist

- [ ] Get push access sorted (grant this session's repo access, or apply the diff manually) and push commit range `6d26611..a601d97` to `main`.
- [ ] Open Vercel dashboard → check Deployments tab per `ROOT_CAUSE.md`'s decision tree → apply the matching fix.
- [ ] Set `CRON_SECRET`, the 5 `META_*` vars, and `WHATSAPP_APP_SECRET` in Vercel env vars.
- [ ] Apply `supabase/migrations/026_leads_source_add_meta_capture.sql` and `027_missing_fk_indexes.sql` to production (Supabase SQL Editor, in order, after redeploy).
- [ ] Redeploy and confirm `/api/health` returns 200.
- [ ] Complete Meta Developer Console setup per `META_SETUP.md`, then run its Testing Checklist (Section C) end-to-end.
- [ ] Review the DB drift items above and decide whether to backfill-document or leave as-is.
