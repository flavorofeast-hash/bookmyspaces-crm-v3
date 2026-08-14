# RELEASE_NOTES.md — BookMySpaces CRM V3, Night Shift Bundle

**Range:** `fe67b76` (base = current `origin/main`) → `a601d97` (head, 12 commits)
**Scope note:** this review covers exactly this range. One further commit (`509de36`, docs-only: adds `PROJECT_STATUS.md`/`NEXT_STEPS.md`) exists locally on top of `a601d97` but is outside the reviewed range and not covered here.
**Review type:** read-only. No code was modified, no commit was created, nothing was merged, in the course of producing this document.

---

## 1. Commit-by-commit summary

### `120e70a` — fix(social): correct Graph API v23 publish endpoints for Meta adapter
- **Purpose:** Facebook publish was always calling `/feed` even when a media URL was supplied; Instagram publish was calling a single-step endpoint that doesn't exist in the Graph Content Publishing API. Fixed to branch Facebook `/photos` (media) vs `/feed` (text-only), and made Instagram always use the mandatory two-step `/media` → `/media_publish` flow, rejecting text-only Instagram posts with a clear `instagram_requires_media` error instead of a confusing Graph API failure.
- **Files:** `src/lib/social/adapters/meta-adapter.ts`, `src/lib/social/meta-adapter.test.ts`
- **Risk:** **Medium** — functional change to a live external API integration path. Mitigated: covered by updated unit tests (8 tests, mocked Graph calls, no live API dependency); no code path currently auto-invokes `publishPost()` in production yet (see `META_SETUP.md`'s Known Limitation), so blast radius today is limited to manual/future-triggered publish calls.
- **Merge?** **Yes.**

### `b7537d1` — docs(deploy): document Vercel 3ff8ca5 pinning root cause with git evidence
- **Purpose:** Adds `ROOT_CAUSE.md`, documenting the git-forensic investigation into why Vercel deploys pin to commit `3ff8ca5` (a parentless root commit — history rewrite) instead of HEAD, with a decision tree for the manual dashboard fix.
- **Files:** `ROOT_CAUSE.md` (new)
- **Risk:** **Low** — documentation only, no code touched.
- **Merge?** **Yes.**

### `6d26611` — chore: remove dead superseded route file duplicates
- **Purpose:** Deletes two orphaned route files that were never registered by Next.js App Router (wrong filename — not literally `route.ts`), each explicitly superseded by a correctly-named sibling already in the tree.
- **Files:** `src/app/api/leads/[id]/stage/lead-stage-route.ts` (deleted), `src/app/api/proposal/share/[token]/api--proposal--share--token--route.ts` (deleted)
- **Risk:** **Low** — verified dead: wrong filename convention means Next.js never routed to these; grep-confirmed no imports reference them; build/test green before and after removal.
- **Merge?** **Yes.**

### `3d5d5a9` — docs(env): document DEFAULT_TAX_RATE_PERCENT
- **Purpose:** Adds the one app-specific env var that existed in code (`src/lib/tax.ts`) but was missing from `.env.example`.
- **Files:** `.env.example`
- **Risk:** **Low** — comment/documentation addition only, no default behavior change (unset still safely falls back to 0% tax, same as before).
- **Merge?** **Yes.**

### `1a710d1` — fix(db): add missing leads_source_check values for Meta lead capture
- **Purpose:** `leads.source` CHECK constraint didn't allow the 4 values Meta Lead Ads/Messenger/Instagram DM capture writes (`facebook_lead_ads`, `instagram_lead_ads`, `facebook_messenger`, `instagram_dm`) — every such lead-capture insert was silently failing (caught, logged, webhook still returned 200). This migration extends the constraint to 11 allowed values.
- **Files:** `supabase/migrations/026_leads_source_add_meta_capture.sql` (new), `026_..._ROLLBACK.sql` (new)
- **Risk:** **Medium** — it's a live-database DDL change (`ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT`), purely additive/permissive (adds allowed values, removes none), idempotent (`DROP CONSTRAINT IF EXISTS`), with a paired rollback. Risk is procedural, not technical: **this migration has not been applied to any live database from this session** (no DB network access) — it only takes effect once someone runs it manually.
- **Merge?** **Yes** (code merge is safe regardless; production benefit requires the separate manual DB step — see DEPLOYMENT_PLAN.md).

### `522add0` — test(social): add coverage for Meta lead-capture and DM-capture paths
- **Purpose:** Adds 13 tests for `meta-lead-capture.ts` (leadgen/messaging event parsing, Graph API detail fetch) and 4 tests for `dm-capture-service.ts` (new-lead creation, existing-lead re-qualification, source mapping, never-throws contract).
- **Files:** `src/lib/social/dm-capture-service.test.ts` (new), `src/lib/social/meta-lead-capture.test.ts` (new)
- **Risk:** **Low** — test-only, no production code touched.
- **Merge?** **Yes.**

### `49e41f5` — docs(meta): add META_SETUP.md
- **Purpose:** Full Meta Developer Console go-live checklist (app config, permissions, webhook subscriptions, env vars, testing checklist, remaining manual tasks), cross-referencing the migration 026 fix.
- **Files:** `META_SETUP.md` (new)
- **Risk:** **Low** — documentation only.
- **Merge?** **Yes.**

### `0eb4407` — perf(db): add missing indexes on foreign-key columns
- **Purpose:** Adds 18 indexes on FK columns confirmed (by reading every migration's `REFERENCES` and `CREATE INDEX` statements) to have no covering index — reduces sequential-scan risk on joins/filters against those columns as data grows.
- **Files:** `supabase/migrations/027_missing_fk_indexes.sql` (new), `027_..._ROLLBACK.sql` (new)
- **Risk:** **Low-Medium** — purely additive (`CREATE INDEX IF NOT EXISTS`), doesn't alter existing data or constraints, has a rollback. Note: not written with `CREATE INDEX CONCURRENTLY` (repo convention wraps migrations in a single transaction, and `CONCURRENTLY` cannot run inside one) — on a table with significant live row counts, plain `CREATE INDEX` takes a brief write lock. Given this app's current scale this is expected to be sub-second per index, but it's a fact worth knowing before running it, not a reason to avoid it. Same procedural caveat as `026`: **not applied to any live database from this session.**
- **Merge?** **Yes** (schedule the live DB application for a low-traffic window given the lock caveat above — see DEPLOYMENT_PLAN.md).

### `7640a37` — fix(api): require auth on proposal pdf/preview routes, escape HTML in receipt route
- **Purpose:** Originally added `requireAuth()` to `proposals/[id]/pdf` and `/preview` (flagged by this pass's API audit as unauthenticated-by-guess-UUID), and added HTML-escaping to `proposals/[id]/receipt` (its sibling `invoice` route already had this fix).
- **Files:** `src/app/api/proposals/[id]/pdf/route.ts`, `src/app/api/proposals/[id]/preview/route.ts`, `src/app/api/proposals/[id]/receipt/route.ts`
- **Risk (as originally authored, standalone):** **High** — the `requireAuth()` addition would have broken a live, intentional, documented feature: the anonymous customer share page (`proposals/share/[token]/page.tsx`) links directly to `/api/proposals/${id}/pdf`, and the preview route's `sent`→`viewed` status flip is the proposal-view-tracking mechanism for that same anonymous flow. This was already investigated and decided in the pre-existing `SECURITY_REVIEW.md` (finding #7): both routes are intentionally public, UUID-as-capability-token, same pattern as the share-token route.
- **Merge?** **No, not standalone.** This commit **must not** be merged without `ce36270` immediately after it (see Dependencies, below). Merged together, the net effect on `pdf`/`preview` is comment-only (see `ce36270` below) and the receipt-route escaping is the only surviving behavioral change from this commit. **Conditional Yes**, paired with `ce36270`.

### `94d1ca7` — fix(cron): fail closed when CRON_SECRET is unset, add error logging
- **Purpose:** All 4 cron routes (`followups`, `escalations`, `campaign-queue`, `stay-lifecycle`) previously used `if (cronSecret) { check token }` — meaning an **unset** `CRON_SECRET` skipped the check entirely and ran the cron job with zero authentication. Changed to fail closed: unset secret → 500, request refused. Also added `try/catch` + `logger.error` to `followups`/`escalations` (the other two already had it), so failures are visible in logs instead of only surfacing as an unhandled 500.
- **Files:** `src/app/api/cron/campaign-queue/route.ts`, `escalations/route.ts`, `followups/route.ts`, `stay-lifecycle/route.ts`
- **Risk:** **Medium-High** — this is a genuine **behavior change**, not a pure hardening-with-no-downside fix. If `CRON_SECRET` is *not currently set* in the production Vercel project, these 4 cron jobs will go from "running unauthenticated" to "failing every invocation with 500" the moment this deploys — an availability regression for follow-ups, escalations, campaign sends, and stay-lifecycle messaging, even though the auth posture is objectively safer. This session cannot check whether `CRON_SECRET` is currently set in Vercel. Note this was a previously-known, previously-*accepted* gap: `SECURITY_REVIEW.md` finding #3 explicitly considered and rejected a code-level fail-closed fix for exactly this reason ("risks breaking legitimate Vercel Cron invocations if the secret isn't wired up yet"), choosing a deployment-checklist-only fix instead. This commit reverses that earlier decision.
- **Merge?** **Conditional Yes** — merge only after confirming `CRON_SECRET` is set in the target Vercel environment (see DEPLOYMENT_PLAN.md, RELEASE_DECISION.md).

### `ce36270` — revert(api): keep proposals pdf/preview routes public
- **Purpose:** Reverts the `requireAuth()` additions from `7640a37` on `pdf`/`preview` after discovering they contradicted `SECURITY_REVIEW.md` finding #7 (see above). Leaves the routes' explanatory comments in place so the "why is this public" question doesn't get re-flagged blind in a future audit.
- **Files:** `src/app/api/proposals/[id]/pdf/route.ts`, `src/app/api/proposals/[id]/preview/route.ts`
- **Risk:** **Low** — a corrective revert restoring previously-safe, previously-live behavior. Net diff vs. `origin/main` on these two files is comment-only (verified via `git diff fe67b76 a601d97` on both files — zero functional change).
- **Merge?** **Yes** — and only together with `7640a37` (see Dependencies).

### `a601d97` — fix(api): reject NaN payment amounts, validate role on admin/users routes
- **Purpose:** (1) `proposals/[id]/payment`'s validation `!amount || Number(amount) <= 0` let a non-numeric string through (e.g. `"abc"` → `Number("abc")` = `NaN`, and `NaN <= 0` is `false`), so `NaN` could reach the `payments.amount` insert. Fixed with `Number.isFinite()`. (2) `admin/users` PATCH/POST passed `body.role` straight to the DB with no app-level check — the DB's own CHECK constraint (migration 009) already blocked invalid values, but surfaced a raw Postgres error instead of a clean 400. Added a `VALID_ROLES` allowlist matching the DB constraint.
- **Files:** `src/app/api/admin/users/route.ts`, `src/app/api/proposals/[id]/payment/route.ts`
- **Risk:** **Low** — both are input-validation tightenings that reject cases which were already going to fail (either silently corrupting data, or erroring at the DB layer) — no previously-working request becomes rejected.
- **Merge?** **Yes.**

---

## 2. `origin/main` vs `a601d97` — files changed, grouped

*(Net diff — reflects the final state of each file, not intermediate commits. 22 files changed: 15 modified, 5 added as new files, 2 deleted. `+1026 / -222` lines.)*

**Meta**
- `src/lib/social/adapters/meta-adapter.ts` — publish endpoint fix
- `src/lib/social/meta-adapter.test.ts` — updated tests
- `META_SETUP.md` — new, go-live checklist

**Database**
- `supabase/migrations/026_leads_source_add_meta_capture.sql` + `_ROLLBACK.sql` — new
- `supabase/migrations/027_missing_fk_indexes.sql` + `_ROLLBACK.sql` — new

**API**
- `src/app/api/admin/users/route.ts` — role validation
- `src/app/api/proposals/[id]/payment/route.ts` — NaN guard
- `src/app/api/proposals/[id]/pdf/route.ts` — comment only (net)
- `src/app/api/proposals/[id]/preview/route.ts` — comment only (net)
- `src/app/api/proposals/[id]/receipt/route.ts` — HTML escaping
- `src/app/api/cron/campaign-queue/route.ts`, `escalations/route.ts`, `followups/route.ts`, `stay-lifecycle/route.ts` — fail-closed auth + logging

**Security**
- (Cross-cutting, not separate files) — cron fail-closed behavior change; receipt-route XSS fix; payment NaN guard; admin role validation. See per-commit entries above.

**Performance**
- `supabase/migrations/027_missing_fk_indexes.sql` + `_ROLLBACK.sql`

**Tests**
- `src/lib/social/dm-capture-service.test.ts` — new
- `src/lib/social/meta-lead-capture.test.ts` — new
- `src/lib/social/meta-adapter.test.ts` — updated

**Docs**
- `ROOT_CAUSE.md` — new
- `META_SETUP.md` — new
- `.env.example` — `DEFAULT_TAX_RATE_PERCENT` documented

**Cleanup**
- `src/app/api/leads/[id]/stage/lead-stage-route.ts` — deleted (dead)
- `src/app/api/proposal/share/[token]/api--proposal--share--token--route.ts` — deleted (dead)

---

## Verification status at `a601d97` (this session)

`npm install`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (417/417 passed, 44 test files), `npm run build` all ran clean at this exact commit before this review began.
