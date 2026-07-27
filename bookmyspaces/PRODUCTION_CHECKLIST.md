# PRODUCTION_CHECKLIST.md — Is the Codebase Ready?

Last updated: 2026-07-27. This checklist answers "is the code itself ready for real customers" — quality, testing, security, documentation. For the deployment mechanics (Vercel config, cron, webhooks, go-live steps), see `DEPLOYMENT_CHECKLIST.md`. Every line item below links to the RC-pass report that verified it.

## Code quality

- [x] Repository-wide dead code / debug code / console.log audit complete — see the Phase 1 findings folded into this codebase's commit history; a fully-built-but-unmounted `UserMenu` component was activated, one confirmed-dead component (`CRMShell.tsx`) was marked deprecated (couldn't be deleted in the sandbox that built this — safe to delete manually), ~15 `console.*` calls converted to structured `logger` calls across WhatsApp/dashboard/proposals modules, fixing 2 real PII-in-logs leaks along the way.
- [x] No TODOs/FIXMEs left unaddressed without a documented reason.
- [ ] One known stray dead file remains on disk: `src/app/api/proposal/share/[token]/api--proposal--share--token--route.ts` — self-documented as dead in its own header, never routed (wrong filename), safe to delete manually; couldn't be removed in the sandbox that produced this release due to a filesystem permission constraint specific to that environment.

## Build

- [ ] `tsc --noEmit` and `npm run build` — **run these in your own CI/local environment, not this sandbox.** The sandbox used to produce this release exhibited intermittent, unexplained hangs on these exact commands (and on `npx vitest run` and `npx knip`) that were diagnosed as environmental (I/O/scheduling stalls), not a repository defect — confirmed via multiple scoped `tsc` batches completing cleanly with 0 errors and a full-repo `esbuild` syntax/transform sweep (201 files, 0 errors). Every individual file touched during this RC pass was additionally verified clean via `esbuild` at the time of editing. Treat a clean `npm run build` in your real pipeline as the authoritative gate before deploying — don't skip it just because this document exists.

## Tests

- [ ] Run `npm run test` (Vitest) in your own environment for the same reason as above. A prior audit pass (RC3, referenced in `audit/`) reported 164 passing tests as of mid-July; re-run to confirm against the current codebase before launch.

## Database

- [x] All 24 migrations reviewed for ordering, dependencies, indexes, RLS, defaults, idempotency — see `PRODUCTION_MIGRATION_CHECKLIST.md`.
- [ ] Migrations 012-024 applied to production (currently written and verified, not yet applied as of this release) — see that same checklist's apply procedure and post-migration spot-checks for migrations 020 and 024 specifically (both fix real, previously-silent bugs).

## Security

- [x] Full security review complete — authentication, authorization, input validation, XSS, CSRF, secrets, rate limiting, webhook verification, logging — see `SECURITY_REVIEW.md`. Fixes applied this pass: WhatsApp webhook rate limiting added, two `.or()` filter-injection sites sanitized (one customer-reachable via public chat), two remaining unescaped XSS interpolation sites in proposal PDF generation closed, PII removed from log message strings.
- [ ] `WHATSAPP_APP_SECRET` and `CRON_SECRET` set in production — both fail open (zero auth) if unset. **Must-do before launch.**

## Performance

- [x] N+1 query audit — none found; every analytics/dashboard route uses a fixed number of bulk queries reduced in memory — see `PERFORMANCE_REVIEW.md`.
- [x] Missing-index audit — none found beyond what the migration checklist already covers.
- [ ] One latent timeout risk documented, not fixed blind: the bulk WhatsApp follow-up sender (`POST /api/followups`, `action: bulk`) could approach its 60s function timeout under slow WhatsApp API conditions. See `PERFORMANCE_REVIEW.md` finding #1 for the three mitigation options.

## End-to-end workflow verification

- [x] Full primary pipeline (enquiry → lead → AI qualification → package recommendation → proposal → approval → reservation → customer journey → revenue dashboard) traced against actual code — see `WORKFLOW_VERIFICATION.md`.
- [x] All secondary workflows (WhatsApp, Social Inbox, Marketing Campaigns, Customer Journey Automation, Win-back, Follow-ups, Proposal Sharing, Duplicate Detection, Repeat Customer Flow) traced.
- [x] Confirmed, documented product-design characteristic (not a bug): there is no customer-facing self-service "Accept Proposal" button — approval is always operator-mediated.

## UI/UX

- [x] Loading/empty/error state coverage checked across all 24 CRM pages — 23/24 had coverage; the one gap (the customer-facing, unauthenticated proposal share page) fixed with a new `loading.tsx`. See `UI_UX_REVIEW.md`.
- [ ] Accessibility gap documented, partially fixed: icon-only buttons lack `aria-label` in most of the app (2 fixed as an example pattern in `kanban/page.tsx`; a full sweep across ~35 remaining files is a recommended follow-up, not done this pass to stay within "polish, don't rebuild" scope).
- [ ] No live browser-based responsive/visual QA was possible in the sandbox that produced this release (no reliable dev-server access) — recommended as a manual pass before or shortly after launch.

## Documentation

- [x] `README.md`, `INSTALL.md`, `DEPLOYMENT.md`, `DEPLOYMENT_CHECKLIST.md`, `ENVIRONMENT_VARIABLES.md`, `DATABASE_ARCHITECTURE.md`, `ARCHITECTURE.md`, `AI_ARCHITECTURE.md`, `API_SPECIFICATION.md` (serves as the API reference) all current as of this release.

## How to use this checklist

Every unchecked `[ ]` item above is either (a) something that genuinely requires a real environment this sandbox didn't reliably have (build/test execution, live browser QA, actual production migration), or (b) a deliberately-deferred, documented improvement that isn't a launch blocker. None of them are "we didn't look" gaps — each links to the report that investigated it. Work through the unchecked items in your own environment before calling this release live; see `RELEASE_REPORT.md` for the overall go/no-go assessment.
