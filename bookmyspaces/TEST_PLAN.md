# TEST_PLAN.md — BookMySpaces CRM V3, Night Shift Bundle

Range: `fe67b76` → `a601d97`. Automated suite already confirmed clean at this exact commit (`npx tsc --noEmit`, `npx eslint .`, `npx vitest run` — 417/417 passed across 44 files, `npm run build`). This checklist covers what automated tests in this repo cannot: live external services, actual Vercel environment state, and manual/visual confirmation.

## Pre-deploy gate

- [ ] `CRON_SECRET` confirmed set in the target Vercel environment (blocks `94d1ca7` from being safe to deploy — see DEPLOYMENT_PLAN.md Step 0).

## Post-deploy — automated-adjacent checks

- [ ] `GET /api/health` → 200.
- [ ] Production build deployed matches `a601d97` (or later) — confirm via Vercel deployment's commit SHA, not just "a deploy happened" (relevant given `ROOT_CAUSE.md`'s pinning issue).

## Cron routes (`94d1ca7`)

- [ ] `GET /api/cron/followups` with no `Authorization` header → expect `401` (not `500` — 500 means `CRON_SECRET` is unset, stop and fix before continuing).
- [ ] Same request with `Authorization: Bearer <wrong-value>` → expect `401`.
- [ ] Same request with `Authorization: Bearer $CRON_SECRET` (correct value) → expect `200` with a JSON body (`processed`/`sent`/`skipped`/`failed` counts).
- [ ] Repeat the above 3 checks for `/api/cron/escalations`, `/api/cron/campaign-queue`, `/api/cron/stay-lifecycle`.
- [ ] Wait for (or manually trigger via Vercel's cron UI) one real scheduled invocation of each of the 4 routes; confirm success in Vercel's function logs, not just that it returned 200 — check for the new `logger.error` lines being absent.

## Proposal pdf/preview — regression check for the `7640a37`/`ce36270` pair

- [ ] Open an existing proposal's customer share link (`/proposals/share/[token]`) in a private/incognito browser (no CRM login).
- [ ] Click "Download PDF" → confirm the PDF/print view loads without a login prompt or 401.
- [ ] Confirm the underlying preview route still flips proposal status `sent` → `viewed` (check the proposal in the CRM after loading the preview anonymously) — this is the one thing that would silently break if the auth revert had been incomplete.
- [ ] As a logged-in operator, open the same PDF/preview URLs from within the CRM proposals list — confirm no regression for the authenticated path either.

## Receipt route escaping (`7640a37`)

- [ ] As a logged-in operator, open `/api/proposals/[id]/receipt` for a proposal/payment whose `client_name`, `notes`, or `transaction_ref` contains characters like `<`, `>`, `&`, or `"` (create a test payment with e.g. `notes: "<script>test</script> & \"quoted\""` if none exists) — confirm the receipt renders the literal text (escaped), not executed markup.
- [ ] Confirm the receipt still requires authentication (this route was never meant to be public, unlike pdf/preview) — a logged-out request should 401.

## Payment NaN guard (`a601d97`)

- [ ] `POST /api/proposals/[id]/payment` with `{"amount": "abc"}` → expect `400` with the "Valid amount is required" message, not a `500` or a corrupted payment row.
- [ ] `POST` with a valid positive numeric amount → still succeeds as before (no regression on the happy path).
- [ ] Confirm no `NaN` rows exist in `payments.amount` from before this fix (`SELECT * FROM payments WHERE amount IS NULL OR amount::text = 'NaN'` or equivalent) — if any exist, they predate this fix and need manual cleanup, not something this fix retroactively corrects.

## Admin role validation (`a601d97`)

- [ ] As an admin, `PATCH /api/admin/users` with `{"user_id": "...", "action": "set_role", "role": "not_a_real_role"}` → expect `400` with the "Invalid role" message.
- [ ] Same request with a valid role (`admin`/`manager`/`sales`/`marketing`) → still succeeds as before.
- [ ] `POST /api/admin/users` (create user) with an invalid role → expect `400` before any auth user or profile row is created (confirm no orphaned auth user was created on rejection).

## Database migrations (026, 027) — run only after code deploy is confirmed stable

- [ ] Run migration 026's pre-flight query — confirm the current live constraint matches the expected 7-value state before applying.
- [ ] Apply migration 026. Run its post-flight query — confirm all 11 values present.
- [ ] Trigger a real (or simulated, if a Meta test event is available) Lead Ads submission / Messenger message / Instagram DM against the connected Page — confirm a `leads` row is created with the corresponding `source` value, not silently dropped. This is the actual end-to-end validation that the original bug is fixed, not just that the constraint changed.
- [ ] Apply migration 027. Confirm via `\d <table>` or `pg_indexes` that all 18 new indexes exist.
- [ ] Spot-check query performance on one or two of the previously-unindexed FK columns (e.g. `EXPLAIN ANALYZE` a query filtering on `message_queue.lead_id`) — confirm the planner now uses the new index where appropriate.

## Meta adapter publish fix (`120e70a`) — deferred until Meta env vars are configured (independent timeline)

- [ ] Facebook text-only post → confirm it publishes via `/feed`.
- [ ] Facebook post with a media URL → confirm it publishes via `/photos`, not `/feed` (verify the resulting post has an attached image).
- [ ] Instagram post with media → confirm the two-step flow completes (container created, then published) and the post appears on the IG Business Account.
- [ ] Instagram post with no media → confirm `publishPost()` returns `{ok:false, error:'instagram_requires_media...'}` rather than attempting a doomed Graph call.
- Full checklist: `META_SETUP.md` Section C.

## Sign-off

- [ ] All items above checked, or explicitly deferred with a reason (e.g. "Meta env vars not yet configured — deferred to Meta go-live, tracked separately").
- [ ] No new errors in Vercel function logs / `logger.error` output in the 24 hours following deploy, beyond expected cron 401s from any misconfigured external caller (if applicable).
