# DEPLOYMENT_PLAN.md — BookMySpaces CRM V3, Night Shift Bundle

Range: `fe67b76` → `a601d97`. This plan assumes the commits reach GitHub via the bundle described in `NEXT_STEPS.md` (this session has no push access), since Vercel deploys from GitHub.

## 3. Dependencies

**Required merge order (hard dependency):**
- `7640a37` → `ce36270` **must merge together, in this order, with nothing separating them.** `7640a37` alone reintroduces a breaking change (auth on the public pdf/preview routes); `ce36270` alone has nothing to revert. If cherry-picking or squashing, treat this pair as one atomic unit — net effect: comment-only on `pdf`/`preview`, HTML-escaping fix survives on `receipt`.
- No other commit in this range has a file-level dependency on another (each touches a disjoint file set, or in the pdf/preview case, only the pair above touches the same files twice).

**Independent commits** (any order, no interaction): `120e70a`, `b7537d1`, `6d26611`, `3d5d5a9`, `1a710d1`, `522add0`, `49e41f5`, `0eb4407`, `a601d97`.

**Commits with an external dependency before they take effect (code merge ≠ production effect):**
- `1a710d1` (migration 026) and `0eb4407` (migration 027) — code merge is safe and self-contained, but neither migration *runs* until manually applied to the live Supabase database. Meta lead capture stays broken and the new indexes don't exist until that manual step happens, regardless of merge/deploy status.
- `94d1ca7` (cron fail-closed) — code merge takes effect immediately on deploy, but its safety depends on `CRON_SECRET` already being set in the target Vercel environment. This is an external state dependency, not a file dependency.

**Optional commits:** None of the 12 are optional in the sense of "unrelated to this release's goals" — the closest to optional are the three pure-docs commits (`b7537d1`, `49e41f5`, `3d5d5a9`), which carry zero code risk and could theoretically be deferred, but there's no reason to: they're needed to operate the rest of the release (Meta go-live steps, deploy root-cause steps, tax env var).

## 4. Risks

**Breaking changes:**
- `94d1ca7` (cron fail-closed) is the one commit in this range with genuine breaking-change potential, and only conditionally: it breaks cron execution *if and only if* `CRON_SECRET` is currently unset in the target Vercel environment. If it's already set (likely, since it's a long-documented must-set item), this commit has zero behavioral impact — it only changes what happens in the edge case that was already a security gap.
- `7640a37` standalone would be breaking (see above); merged with `ce36270` as required, net effect is non-breaking.

**Database migrations:**
- `026_leads_source_add_meta_capture.sql` — additive CHECK constraint extension. `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` pattern, idempotent, wrapped in `BEGIN`/`COMMIT`. No data rewritten. Pre-flight query included in the file's header comment to confirm current constraint state before running.
- `027_missing_fk_indexes.sql` — additive `CREATE INDEX IF NOT EXISTS` × 18. No `CONCURRENTLY` (can't combine with the transaction-wrapped convention this repo uses) — takes a brief write lock per table during index build. At current data volumes this is expected to be fast; re-verify row counts for the largest tables (`leads`, `proposals`, `unified_messages`) before running if volume has grown significantly since this was written.
- **Neither migration has been applied to any live database from this session** — both are file-only until someone runs them (Supabase SQL Editor or CLI, in numeric order: 026 then 027).

**Auth:**
- `94d1ca7` changes cron auth from fail-open to fail-closed (see Breaking changes above).
- `a601d97`'s admin/users role validation is additive-only (rejects invalid roles that would have failed at the DB layer anyway) — no auth-weakening risk.
- `7640a37`+`ce36270` net effect leaves proposal pdf/preview auth posture unchanged from `origin/main`.

**API:**
- `a601d97`'s payment NaN guard tightens validation on `proposals/[id]/payment` POST — rejects requests that were already going to either insert `NaN` (bad) or fail; no legitimate previously-working request is newly rejected.
- `7640a37`'s receipt-route HTML escaping is a pure defense-in-depth addition, no behavior change to legitimate output.

**Cron:**
- Covered above (`94d1ca7`). This is the single highest-attention item in this release from a deployment-sequencing standpoint.

**Env vars:**
- `CRON_SECRET` — must be confirmed set in Vercel *before* this deploy reaches production, given `94d1ca7`. This is the one pre-deploy gate in this release.
- `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_ID` — not required for this deploy to be safe (Meta integration fails closed/safe when unconfigured, per `META_SETUP.md`), but required before Meta features (publishing, lead capture, replies) will function. Independent of this deploy's safety.
- `DEFAULT_TAX_RATE_PERCENT` — optional, documented-only, safe default (0) if unset.

**Rollback impact:** see `ROLLBACK_PLAN.md`.

## 5. Deployment plan

**Step 0 — Pre-deploy gate (do this before anything else):**
1. Confirm `CRON_SECRET` is currently set in the target Vercel project's environment variables. If it is not set, either set it now, or exclude `94d1ca7` from this deploy (see RELEASE_DECISION.md, Option C) until it can be set in the same change window.

**Step 1 — Get code to GitHub / Vercel:**
2. Apply the bundle (or grant push access) per `NEXT_STEPS.md` item 1 to bring `main` up to `a601d97`.
3. Resolve the separate, unrelated Vercel deployment-pinning issue per `ROOT_CAUSE.md` — otherwise none of this code reaches production regardless of what's on GitHub.
4. Let Vercel build and deploy from the updated `main`.

**Step 2 — Post-deploy verification (before touching the database):**
5. Confirm `/api/health` returns 200.
6. Confirm cron routes respond as expected: a request to any `/api/cron/*` route with a correct `Authorization: Bearer $CRON_SECRET` header succeeds; without it, returns 401 (not 500 — 500 would mean `CRON_SECRET` itself is unset, back to Step 0).
7. Confirm a proposal's PDF and preview links still work anonymously (no login) via a share link — this is the one path most worth a direct human check given `7640a37`'s history in this range.

**Step 3 — Database migrations (after code is confirmed live and stable):**
8. Run `supabase/migrations/026_leads_source_add_meta_capture.sql` — pre-flight query first (in the file header), then the migration, then the post-flight query.
9. Run `supabase/migrations/027_missing_fk_indexes.sql`. Consider running during a lower-traffic window given the brief write-lock-per-table caveat above.
10. Confirm both via each file's post-flight verification query.

**Step 4 — Functional confirmation:**
11. Trigger (or wait for) a real cron invocation and confirm it completes successfully with `CRON_SECRET` set.
12. Once Meta env vars are separately configured (independent of this deploy), run `META_SETUP.md`'s Testing Checklist end-to-end, including confirming a test Lead Ads/Messenger/DM submission now creates a `leads` row (validates migration 026 took effect).

See `TEST_PLAN.md` for the full checklist this maps to.
