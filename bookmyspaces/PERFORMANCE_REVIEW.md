# Performance Review — BookMySpaces CRM V3

Produced during the Release Candidate hardening pass. Covers large/N+1 queries, missing indexes, slow APIs, large React renders, duplicate API calls, bundle size, caching, and DB aggregation, per the RC directive's Phase 6 scope. "Only optimize where beneficial" — findings below are fixed where safe, otherwise documented with a concrete recommendation.

## N+1 queries — none found

Every analytics/dashboard module in this codebase (`revenue-intelligence.ts`, `dashboard/stats/route.ts`, `dashboard/operations/route.ts`, `dashboard/revenue/route.ts`) follows the same deliberate pattern: a small, fixed number of bulk queries (usually via `Promise.all`) fetched once, then grouped/aggregated in memory. None of them loop over rows making a query per row. This is called out explicitly in `revenue-intelligence.ts`'s own header comment as a "PERFORMANCE CONTRACT" — verified true by reading every function in that file (7 analytics sections, 8 queries total, zero per-row queries).

The one loop-with-await pattern found (`src/app/api/followups/route.ts`'s `bulk` action) is not a DB N+1 — it's a sequential dispatch to the WhatsApp send API with a deliberate 1.5s throttle between sends, capped at 20 leads per call. See finding #1 below for the real risk this creates.

## Finding 1 — Bulk follow-up sender may exceed its own timeout budget

`POST /api/followups` (`action: 'bulk'`) fetches up to 20 leads, then sequentially: sends a WhatsApp message, updates the lead, sleeps 1500ms. Worst case: 20 x (WhatsApp API latency + 1.5s sleep + 2 DB writes) can approach or exceed the route's `maxDuration = 60`. If Vercel kills the function mid-batch, leads already sent won't be retried but leads after the cutoff silently won't get a follow-up this run — no partial-failure signal reaches the caller.

Not fixed blind this pass — the safe fix (moving this onto the existing queue-based `message_queue` infrastructure that Campaign Scheduler already uses, instead of sending synchronously in the request) is a real behavior change that needs to be tested against the live WhatsApp API, which this sandbox cannot reach. Documented here as a launch-readiness item: either (a) lower the batch limit from 20, (b) drop the 1.5s throttle in favor of the queue's own pacing, or (c) accept the current bound (worst case ~20 leads, `maxDuration=60` gives real headroom under normal WhatsApp API latency) and monitor in production.

## Finding 2 — Revenue Intelligence / dashboard routes do full, unbounded table scans

`buildRevenueIntelligence()`, `dashboard/stats`, and `dashboard/hot` all `SELECT` the full `leads`/`proposals`/`reservations` tables with no `.limit()`, then filter/aggregate in JS. This is fine at current data volume and is explicitly the tradeoff the codebase already made everywhere (documented in `revenue-intelligence.ts`) rather than something introduced this pass. It stops being fine once any of these tables grows into the tens of thousands of rows — at that point the right fix is SQL-side aggregation (a Postgres view or RPC), not more JS filtering. Not implemented this pass: it requires a new migration this sandbox cannot apply or verify against production data. Flagged as the top scalability item for a post-launch pass, not a pre-launch blocker at expected initial data volume.

## Missing indexes — none found beyond what Phase 3 already covers

`PRODUCTION_MIGRATION_CHECKLIST.md` (Phase 3, this same RC pass) already verified every foreign key and commonly-filtered column (`status`, `created_at`, `lead_id`, etc.) has a matching index across migrations 012-024. No additional gaps found while reviewing the query patterns in this phase — the full-table-scan routes above don't have a `WHERE` clause to index against in the first place (they scan everything by design), so this is an aggregation-strategy question, not a missing-index one.

## Bundle size

Checked the two heaviest dependencies (`googleapis`, `xlsx`) plus `mammoth`/`pdf-parse` (used for document parsing on import): all four are imported only from `src/lib/excel-parser.ts` and `src/lib/sheets.ts`, both server-only modules reached exclusively from API routes (`leads/import`, Google Sheets sync). Confirmed via grep — none of these are imported from any client component (`'use client'` file), so none of them ship to the browser bundle. No action needed.

## Duplicate API calls / large React renders

Not exhaustively re-audited this pass — this would require running the actual Next.js dev server and profiling real page loads, which this sandbox's build-tooling instability (see `PRODUCTION_BUILD` notes, Phase 2) makes unreliable to do meaningfully. Spot-checked the dashboard pages (`HotLeadDashboard.tsx` and siblings, 8 client components under `app/(crm)/dashboard/`) for the most common anti-pattern — a `useEffect` with a fetch call and no dependency array guard causing repeated fetches — and didn't find one in the files opened during Phase 1's dead-code pass. A full component-by-component render audit is better suited to Phase 7 (UI/UX polish), which is next.

## Caching

No HTTP-level or in-memory caching exists on the analytics/dashboard routes today (every dashboard load re-runs the full bulk-query set). Given Finding 2's full-table-scan pattern, a short TTL cache (30-60s) on `buildRevenueIntelligence()`'s result would cut both DB load and perceived dashboard latency on repeat views within a session, at the cost of slightly stale numbers. Not implemented this pass — it's a genuine improvement opportunity, not a correctness fix, and the RC directive scopes this phase to "optimize where beneficial," not to add new caching infrastructure without being able to verify cache-invalidation correctness in this sandbox. Recommended as a fast, low-risk post-launch win.

## Memory usage

No server-side unbounded accumulation found — every "fetch everything, reduce in memory" query caps out at the size of the underlying tables, which are bounded by real-world CRM data volume (leads/proposals/reservations for one business, not a multi-tenant scale problem). No action needed at current or expected near-term scale.

## Summary of code changes made this pass

No functional performance code changes were needed or made — every finding above is either already-optimal (N+1 audit, bundle size, missing indexes) or a documented, deliberately-deferred improvement (bulk follow-up timeout risk, full-table-scan aggregation strategy, dashboard caching) that requires either live-API testing or a production migration this sandbox cannot safely perform blind.
