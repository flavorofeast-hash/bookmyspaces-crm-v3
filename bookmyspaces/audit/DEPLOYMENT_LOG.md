# BookMySpaces V3 — Live Production Deployment Log

Deployment environment: `C:\rajubmp` on Raju's local machine (production deployment environment, per his confirmation).
Deployment controller: Claude, acting as Deployment Lead / DevOps Engineer / Release Manager / Production Support Engineer / Technical Incident Manager for this session.
Started: 2026-07-15

Format per step: Step Number | Task | Commands Executed | Expected Result | Actual Result | Verification | PASS/FAIL | Issues | Resolution | Time Completed.

---

## Step 1 — Local Environment Verification

- **Task:** Confirm Node/npm versions, git branch, working tree state on the actual deployment machine.
- **Commands Executed:** `node --version` / `npm --version` / `git branch --show-current` / `git status --short`
- **Expected Result:** Node ≥18.17 (ideally 20+), npm present, branch `feature/v3-omnichannel-platform`, clean working tree.
- **Actual Result:** Node v24.16.0, npm 11.13.0, branch `feature/v3-omnichannel-platform`, working tree clean aside from intentional/out-of-repo items (`audit/DEPLOYMENT_LOG.md` untracked-but-intentional, plus prior sessions' `.git.stale-*`/`.git.corrupted-*` recovery directories and `probe_delete_test.txt` sitting outside the repo).
- **Verification:** All four checks meet success criteria. Node v24 is newer than the v20.x this project has been validated against in prior sessions, but well above the v18.17 floor Next.js 14.2.5 requires — not a blocker, flagged for awareness only (revisit if Step 10's production build behaves unexpectedly).
- **Status:** PASS
- **Issues:** None. Untracked items listed are outside the repo or explicitly intentional (the log file itself).
- **Resolution:** N/A
- **Time Completed:** 2026-07-15 (Step 1)

**Repo-side check already performed (this session's sandbox, same repo files via the mounted folder):** Node v22.22.3, npm 10.9.8, branch `feature/v3-omnichannel-platform`, last commit `a059aad`, working tree clean, `node_modules` present (677M). Confirms repo state itself is sound; Step 1 on the deployment machine confirms the execution environment independently.

---

## Step 2 — Git Verification

- **Task:** Confirm the deployment machine's git state matches what will actually ship — remote configured correctly, local branch in sync (or intentionally ahead) with remote, no surprise divergence before Vercel deployment.
- **Commands Executed:** `git remote -v` / `git fetch origin` / `git status -sb` / `git log origin/feature/v3-omnichannel-platform..HEAD --oneline`
- **Expected Result:** Remote reachable; `origin/feature/v3-omnichannel-platform` exists; ahead/behind count known.
- **Actual Result:** Remote `origin` = `https://github.com/raju1605jobs-hash/bookmyspaces-crm-v2.git`, fetch succeeded. `git log origin/feature/v3-omnichannel-platform..HEAD` failed: `fatal: ambiguous argument ... unknown revision` — the remote has no `feature/v3-omnichannel-platform` branch.
- **Verification:** Confirms this branch has never been pushed to `origin`. Consistent with this project's entire development history: every prior engineering session ran in a sandboxed environment with no live git push capability, so all commits accumulated locally on this machine only.
- **Status:** IN PROGRESS — user executed a resolution (merge to `main` + push + backup branch + local build) without the two facts I'd requested (remote branch list, Vercel Production Branch setting) being reported back first. Holding this step open pending independent verification below rather than marking PASS on a self-report.
- **Issues:** `feature/v3-omnichannel-platform` existed only locally; user has since fast-forward merged it into `main` locally, created `release-v3-backup`, and pushed `feature/v3-omnichannel-platform` to GitHub. **Not yet confirmed:** whether `main` itself was pushed to `origin` (Vercel can only build what's actually on GitHub), and Vercel's configured Production Branch (still outstanding from the prior ask).
- **Resolution:** Pending — see verification commands issued next.
- **Time Completed:** _pending, Step 2 still open_

---

## Step 2b — Merge/Push/Build Verification

- **Task:** Confirm `main` is actually on GitHub (not just updated locally), confirm `release-v3-backup` exists at the correct commit, confirm the reported clean build, close the Vercel Production Branch question.
- **Commands Executed:** `git checkout main` / `git log --oneline -5` / `git status -sb` / `git push origin main` / `git ls-remote --heads origin`
- **Expected Result:** `origin/main`, `origin/feature/v3-omnichannel-platform`, `origin/release-v3-backup` all present on GitHub at the same commit; local `main` in sync with `origin/main`; no ahead/behind.
- **Actual Result:** `git ls-remote --heads origin` confirms all three refs (`main`, `feature/v3-omnichannel-platform`, `release-v3-backup`) point to `a059aadf49de02eceaad6222e613c6f628eb02f1`. `git status -sb` returns `## main...origin/main` with no ahead/behind marker — only untracked items (`.git.corrupted-*`, `.git.stale-*`, `audit/DEPLOYMENT_LOG.md`, `probe_delete_test.txt`), none of which are deployment blockers. Production build (`npm run build`), TypeScript, ESLint, and Vitest (164/164) previously confirmed passing by Raju, accepted without re-verification per his explicit instruction.
- **Verification:** Independently confirmed — `main` is genuinely on GitHub at the correct commit, matching `feature/v3-omnichannel-platform` and the `release-v3-backup` safety branch. This closes the gap flagged earlier (local merge ≠ deployed).
- **Status:** PASS
- **Issues:** None remaining.
- **Resolution:** N/A
- **Time Completed:** 2026-07-15 (Git Verification)

---

## Step 3 — Vercel Production Configuration (in progress)

Sub-steps per Raju's explicit sequencing: (1) Connected Repository, (2) Production Branch, (3) Production Environment Variables, (4) gap analysis, (5) readiness confirmation before migrations.

### 3.1/3.2 — Connected Repository + Production Branch

- **Task:** Confirm Vercel is wired to `raju1605jobs-hash/bookmyspaces-crm-v2` and confirm which branch is its Production Branch.
- **Commands Executed:** Dashboard check — Settings → Git (repository), Settings → Environments → Production (branch tracking, corrected navigation after Vercel moved this setting out of Settings → Git).
- **Expected Result:** Repository = `raju1605jobs-hash/bookmyspaces-crm-v2`; Production branch = a real branch that exists on origin.
- **Actual Result:** Connected Repository confirmed as `raju1605jobs-hash/bookmyspaces-crm-v2`. Production environment Branch Tracking = `main`.
- **Verification:** Cross-referenced against Step 2's `git ls-remote` evidence — `origin/main` exists and points to `a059aad`. Production deployment path (repo → branch → commit) is now fully verified end-to-end.
- **Status:** PASS
- **Issues:** None.
- **Resolution:** N/A
- **Time Completed:** 2026-07-15 (Step 3.1/3.2)

### 3.3 — Production Environment Variables (group-by-group)

- **Task:** Confirm every required env var exists in Vercel's Production environment before any migration is applied.
- **Status:** IN PROGRESS

**Group 1 — Supabase: PASS**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` all confirmed present in Production (and Preview) via Vercel CLI.
- First attempt returned unfilled template placeholders (`<your-project-ref>`, literal `xxxxxxxx`) — held open, not accepted, per "never assume success." Re-verified with real values.
- Project ref `nssteddtqgqubggpcwae` confirmed to match local `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` (`https://nssteddtqgqubggpcwae.supabase.co`) — cross-checked directly against the repo file this session. Production app and upcoming migrations 012/013(/004) will target the same Supabase project. No mismatch risk.
- Time completed: 2026-07-15 (Group 1)

**Group 2 — AI Providers: PASS**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` both confirmed present in Production (and Preview) via `vercel env ls`. Values not inspected, consistent with secret-handling guidance for this group.
- Time completed: 2026-07-15 (Group 2)

**Group 3 — Google Sheets Sync: PRESENCE VERIFIED (functional validation deferred to UAT)**
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_ID` all confirmed present in Production via `vercel env ls`.
- Value correctness NOT cross-checked against local `.env.local` — local copy contains placeholder values for `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SHEETS_ID`, so it isn't a usable reference for this integration.
- Deferred deliberately, not skipped: `INFRASTRUCTURE_VALIDATION.md` already flagged that Google Sheets sync's failure mode (silent vs. surfaced) was never confirmed in any prior session — a functional check during UAT is the correct place to close this, not a presence-only gate before migrations.
- Status: not a launch blocker. Revisit during UAT (deployment sequence Step 17+, or UAT scenario coverage if sync-specific behavior is exercised).
- Time completed: 2026-07-15 (Group 3, presence only)

**Group 1 (Supabase) / Group 2 (AI Providers) — STATUS CLARIFICATION:** downgraded from unconditional PASS to "presence verified via `vercel env ls`; value-integrity NOT independently confirmed." `vercel env pull --environment=production` returned empty strings for all protected variables. Two possible explanations, indistinguishable from current evidence: (a) Vercel's legitimate "Sensitive" variable feature, which makes values permanently unreadable post-creation — benign; (b) a documented Vercel CLI bug ([GitHub issue #16160](https://github.com/vercel/vercel/issues/16160)) where `vercel env add NAME production --sensitive --value=X --yes` silently stores an EMPTY value while `env ls` still shows "Encrypted" — not benign. `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are the exception — their real values were confirmed directly (project ref match), so those two specifically are conclusively verified, not just presence-checked. `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` remain presence-only. **Closing verification scheduled:** Step 16 (Health Check) for Supabase service role key, Step 20 (AI Assistant) for Anthropic/OpenAI keys — these are the first real functional calls and will conclusively resolve this either way.

**Group 4 — App Config: PRESENCE VERIFIED (value integrity deferred to runtime check)**
- `NEXT_PUBLIC_BUSINESS_WHATSAPP` matches local (`9051459463`), self-reported correct.
- `NEXT_PUBLIC_APP_URL`: confirmed present in Production/Preview. Confirmed marked "Sensitive" in Vercel dashboard — unusual for a `NEXT_PUBLIC_` var (no confidentiality benefit once inlined into the public JS bundle at build time) but means neither CLI pull nor dashboard reveal can inspect the stored value; edit form shows Vercel's placeholder text (`https://api.example.com`), not the real value.
- Deferred deliberately: value will be directly, conclusively visible in the deployed page source and in any real share-link/redirect immediately after Vercel deployment. **Verification scheduled:** confirm actual production domain appears in generated links/redirects during Step 16 (Health Check)/Step 17 (Website Chat) rather than localhost or placeholder.
- Recovery path if wrong: overwrite the Sensitive variable's value directly (can't reveal, but can overwrite) and redeploy.
- Time completed: 2026-07-15 (Group 4, presence + deferred runtime check scheduled)

**Group 5 — WhatsApp Cloud API: PASS (3 of 4) + CONFIRMED GAP (1 of 4)**
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` confirmed present in Production via `vercel env ls`.
- `WHATSAPP_APP_SECRET` confirmed **absent** from Production (`vercel env ls | findstr WHATSAPP_APP_SECRET` returned no match). This is not a new finding — it's the direct Production-side confirmation of Critical finding C2 from `PRODUCTION_READINESS_REVIEW.md`, tracked across every prior session as an unresolved blocker.
- **Action scheduled:** Step 6 (Configure `WHATSAPP_APP_SECRET`) — must be created in Production before deployment proceeds. Without it, webhook signature verification stays unenforced (logs a warning, still accepts unsigned requests).
- Time completed: 2026-07-15 (Group 5)

**Group 6 — Legacy WATI (optional): PASS**
- `WATI_BASE_URL`, `WATI_API_TOKEN` confirmed absent — matches expected architecture (Meta Cloud API is the live send/receive path, not WATI).
- `WATI_VERIFY_TOKEN`, `WATI_WEBHOOK_SECRET` found present (Production, Preview) — not a problem, but per `.env.example`'s own documented history (ISS-029/ISS-038), these are explicitly flagged as removed/unreferenced: "no matching webhook code path exists." Confirmed dead configuration, not active legacy config. Harmless; candidate for Vercel cleanup in a future pass, not a deployment blocker.
- Time completed: 2026-07-15 (Group 6)

**Group 7 — Resend Email: NEW FINDING — decision required**
- `RESEND_API_KEY`, `EMAIL_FROM` both confirmed **absent** from Vercel Production (`vercel env ls | findstr` returned no match for either).
- This is a genuinely new finding, not previously documented in any prior session — every earlier audit only had `.env.local` access, where both are confirmed present. This is the first direct check against Production.
- Impact (from confirmed code behavior): proposal-email send degrades to a `mailto:` fallback (functional, weaker UX). Invoice/payment-reminder/booking-confirmation/follow-up email routes have no fallback — they return "not configured yet" and do not send.
- Classified as a likely blocker (not a known/intentional V1 scope decision) — recommendation given to configure both in Production before deployment. Final decision is Raju's, pending his response.
- Status: BLOCKED — awaiting Product Owner decision.
- Time completed: _pending decision_

**Group 8 — Cron Authentication: NEW FINDING**
- `CRON_SECRET` confirmed **absent** from Vercel Production. Genuine gap, not value-masking (variable name itself absent from `env ls`).
- Impact: `/api/cron/followups` (daily 9am) and `/api/cron/escalations` (every 6 hours) both fail closed without it — both cron jobs are currently completely non-functional in Production, not just less secure. This is Vercel's own cron-auth convention (Vercel automatically sends `CRON_SECRET` as a Bearer token to registered cron routes when the env var is set) — without it, there's nothing for the route to verify against.
- Status: BLOCKED — folded into the same Product Owner decision as Group 7.
- Time completed: 2026-07-15 (Group 8, finding confirmed)

**Product Owner Decision (Raju):** configure all four before migrations/deployment — `WHATSAPP_APP_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`. Stated goal: customer-facing email workflows, WhatsApp webhook verification, and scheduled follow-up/escalation jobs fully operational Day 1. Step 3.3 closed on this basis — proceeding to configuration.

---

## Step 3 — Gap Analysis Summary (item 4 of 5)

**8 groups checked, 19 variables total.**

| Status | Variables |
|---|---|
| Fully verified (value + presence) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (project ref cross-checked against local) |
| Presence verified, value-integrity confirmed only by upcoming runtime test | `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Step 16/20), `NEXT_PUBLIC_APP_URL` (Step 16/17), `NEXT_PUBLIC_BUSINESS_WHATSAPP` (self-confirmed correct) |
| Presence verified, functional check deferred to UAT | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_ID` |
| Present and correct | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` |
| Confirmed absent — dead/unused code, no action needed | `WATI_BASE_URL`, `WATI_API_TOKEN` (never set, correctly) |
| Present but confirmed dead code, harmless | `WATI_VERIFY_TOKEN`, `WATI_WEBHOOK_SECRET` |
| **Confirmed absent — blocking, scheduled for configuration now** | `WHATSAPP_APP_SECRET` (known since RC1), `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET` (both newly discovered this session) |

**Net new findings this session, not previously known from any prior audit:** `RESEND_API_KEY` and `EMAIL_FROM` absent from Production (present in `.env.local` only — never propagated); `CRON_SECRET` absent from Production (both cron jobs currently non-functional, not just insecure). These were only discoverable by checking the actual Production environment directly, which no prior sandboxed session ever had access to.

---

## Step 3.4 — Pre-Deployment Configuration (4 variables)

Order: `WHATSAPP_APP_SECRET` (external retrieval required) → `CRON_SECRET` (generate fresh) → `RESEND_API_KEY` (reuse existing) → `EMAIL_FROM` (value-quality decision needed).

**Scope-change request and resolution (logged for record):** Raju requested a 7-phase architectural refactor mid-deployment — complete removal of legacy WATI code/references, full repo audit, doc updates, rebuild, and a second full production readiness audit. Flagged as conflicting with this session's own "engineering complete, no new audits/refactors unless a real production issue is found" framing — WATI is confirmed dead/unreferenced code (Group 6), not a production issue, and reopening the codebase mid-deployment would invalidate the already-verified build/test/commit state. Raju decided: keep current architecture for Release 1, complete production deployment with no new code changes, schedule WATI removal as the first post-production maintenance release (v3.1) with its own dedicated refactor/regression-testing/documentation cycle. Deployment resumes on the existing verified codebase. **Action item for later:** add v3.1 WATI removal to `VERSION1_1_ROADMAP.md` (or a new `VERSION3_1_ROADMAP.md`) after go-live — not now.

Resuming Step 3.4 at `WHATSAPP_APP_SECRET`, previously issued, awaiting confirmation.

**Update:** `WHATSAPP_APP_SECRET` and `CRON_SECRET` confirmed configured in Vercel Production by Raju. `RESEND_API_KEY`/`EMAIL_FROM` deliberately left unconfigured — Product Owner decision: email automation deferred for V3.0, staff will send emails manually.

**Resend graceful-degradation audit (verification only, no code changes):** searched all 9 files referencing Resend/`RESEND_API_KEY`/`EMAIL_FROM`. Findings — every one of Raju's 6 requirements was already satisfied by existing code from prior sessions (ISS-036/041/042), nothing new needed:
- No exception path: `isEmailProviderConfigured()` gates every send before any network call (`src/lib/email/provider.ts`).
- No startup failure: `src/lib/env.ts`'s `assertEnv()` explicitly lists `RESEND_API_KEY`/`EMAIL_FROM` under `OPTIONAL_VARS` (feature: "Transactional email (Resend)") — only `console.warn`s, never throws for these.
- No API route failure: proposal-email route falls back to a `mailto:` link (200 response); invoice/payment-reminder/booking-confirmation/follow-up routes return a controlled 503 with a clear message — no unhandled exceptions anywhere in the path.
- Warning already logged: `assertEnv()`'s startup log names "Transactional email (Resend)" specifically when missing.
- All other functionality unaffected: Auth/Dashboard/Leads/CRM/Kanban/AI Assistant/WhatsApp/Proposal-generation/Google-Sheets/Analytics have zero imports from the email path.
- Documentation updated: `INFRASTRUCTURE_VALIDATION.md`'s Resend row rewritten to reflect the deliberate V3.0 decision and re-enable path.

**Quality gates (re-run per Raju's request, confirming no regression from a decision that required zero code changes):**
- ESLint: 0 errors, 1 known pre-existing warning (`UserMenu.tsx` `<img>` usage) — unchanged.
- TypeScript: 0 errors — unchanged.
- Vitest: could not complete in this sandbox — `@rollup/rollup-linux-x64-gnu` missing from `node_modules/@rollup/` (only Windows binaries present: `rollup-win32-x64-gnu`, `rollup-win32-x64-msvc`). Root cause: `node_modules` is shared between this Linux sandbox and Raju's Windows machine via the mounted folder; whichever side last ran `npm install` (Raju's `npm run build` in Step 2b) determines which platform's optional native binary is present. This is an environment artifact, not a code regression — nothing in this session's Resend audit touched test-covered code. Authoritative confirmation deferred to Raju's own machine, where the full suite already passed 164/164 at Step 1/2b.
- Status: no code changed, so no regression is possible from this decision. Full re-confirmation of Vitest recommended on Raju's machine for the record.
- Time completed: 2026-07-15 (Resend audit + doc update)

**Scope note for later (not deployment work):** Raju requested a 10-document product Knowledge Base (User Manual, System Administration Manual, Technical Architecture Guide, Operations Manual, Deployment & DR, Product Owner Handbook, API & Integration Reference, Developer Handbook, Project Audit Report, Master Index) — a continuity/succession-planning deliverable comparable in scope to this project's entire prior engineering effort. Decision: finish this live deployment first; Knowledge Base to follow as its own dedicated, properly-resourced engagement post-launch. Action item for later, not now.

**Resuming deployment.** Next: confirm `CRON_SECRET` presence in Production (Raju self-reported configured; verifying before moving to Step 4/Supabase migrations).

---

## PRODUCTION INCIDENT — Reservations module: "No bookable rooms/halls found"

**Reported:** Raju deployed to Vercel and ran production testing; Reservations module cannot create reservations, shows the above message.

**Context worth noting for the record:** this deployment session never actually completed Steps 4–7 of the original plan (Database Backup → Apply Migration 012 → Validate → Apply Migration 013 → Validate → Migration 004 decision → Smoke Test) in this conversation before Raju reported the Vercel deployment as complete. This symptom is consistent with the database migrations never having been executed, though per "do not guess," this is confirmed below via source inspection, not assumed from that alone.

**Investigation — source code trace (repository inspection, no live DB access from this sandbox):**
1. `supabase/migrations/012_v3_foundation_schema.sql` (full file re-read): creates `properties`, `inventory_items`, `reservations`, and 12 other tables, all via `CREATE TABLE IF NOT EXISTS`, all idempotent. Seeds exactly 2 rows into `properties` (Skyline Serenity, Monurama Homestay). **Does NOT seed any `inventory_items` rows** — no `INSERT INTO inventory_items` anywhere in the file. This is deliberate, per the master spec's "no hardcoded properties/inventory" requirement.
2. `scripts/apply-v3-migrations.mjs` and `scripts/smoke-test-v3.mjs` — both scripts' own success messages explicitly state: *"Next: add real inventory_items/rate_plans for both properties... no rooms/rates yet."* This was always a known, flagged, manual data-entry step — also called out in `UAT_OPERATOR_CHECKLIST.md`'s Setup section ("no admin UI for this yet, add directly via Supabase Table Editor or SQL").
3. `src/app/(crm)/reservations/page.tsx:372-378` — fetches `/api/properties`, and **swallows any fetch error into an empty array** (`.catch(() => setInventoryItems([]))`).
4. `src/app/api/properties/route.ts` — calls `listActiveProperties()`/`listActiveInventoryItems()` and, per its own header comment, **both already return `[]` rather than throwing when the tables don't exist** — degrades to `{ properties: [] }` instead of a 500.
5. `src/lib/reservations/property-service.ts:50,117` — confirmed directly: `if (error || !data) return []` in both functions. A genuine "relation does not exist" Postgres error and a genuinely-empty-but-existing table produce **the exact same return value** at every layer, all the way to the UI.

**Conclusion of source trace:** the UI message "No bookable rooms/halls found... usually means migration 012 hasn't been applied" is a plausible guess written into the frontend, not a diagnostic that can actually distinguish two different real causes:
- **Cause A:** Migrations 012/013 were never applied to production at all (tables don't exist).
- **Cause B:** Migrations were applied successfully (properties seeded), but `inventory_items` is empty because no real room/hall data has been entered yet — this was always expected as a manual step, by design, not a bug.

These require entirely different fixes (schema DDL vs. real business data entry), so which one is true must be confirmed against the live database before any fix is written. Diagnostic SQL issued next.

**Diagnostic result (Raju, live production Supabase, project `nssteddtqgqubggpcwae`):** confirmed **Cause A** — `properties`, `inventory_items`, `reservations`, `rate_plans`, `meal_plans`, `addon_services` do not exist in production at all. Migration 012 was never applied. This is a schema gap, not an empty-inventory data-entry situation.

**Pre-execution safety review of 012_v3_foundation_schema.sql (full file, re-inspected):** creates 14 new tables only via `CREATE TABLE IF NOT EXISTS`; no `ALTER`/`DROP TABLE`/`DELETE` on any pre-existing table anywhere in the file; one additive `INSERT INTO properties ... ON CONFLICT (slug) DO NOTHING`. `DROP TRIGGER IF EXISTS`/`DROP POLICY IF EXISTS` immediately followed by `CREATE` of the same name are the standard idempotent re-run idiom, scoped only to the new tables — no-ops on a first run. **Verdict: SAFE TO RUN**, conditional on two prerequisites confirmed present in production first: (1) `leads`, `proposals`, `invoices` tables (pre-V3 CRM, referenced by new FKs, not altered), (2) the `update_updated_at_column()` trigger function (created by migration 001, referenced but not (re)created by 012). Raju's own diagnostic checked 6 of the 14 new table names — recommended confirming the other 8 (`customer_identities`, `channels`, `unified_conversations`, `unified_conversation_channels`, `unified_messages`, `ai_prompts`, `knowledge_sources`, `ai_interaction_log`, `reservation_addons`, `settings` — 10, not 8) are also genuinely absent (expected, not a blocker either way) before running.

**Scope note for later (not incident work):** Raju requested a full codebase feature-matrix audit (Reservations/CRM/WhatsApp/Website Chat/Facebook/Instagram/LinkedIn/Google Business/Google Ads/Facebook Ads/Reviews/Unified Inbox/AI/Analytics/Channel Manager/Email/Campaigns, classified Implemented/Partial/Placeholder/Planned/Not Started, with v3.1/3.2/4.0 roadmap recommendations). Deferred until the live Reservations incident is fully resolved and verified — same reasoning as the Knowledge Base and WATI deferrals.

**Incident resolution — root cause confirmed, code fix applied:** migration 012 confirmed applied in production (properties: 2 rows, inventory_items: table exists, 0 rows). Root cause of the misleading "No bookable rooms/halls found... migration 012 hasn't been applied" message: hardcoded UI string that conflates two different conditions (`inventoryItems.length === 0`) — missing table vs. empty table — traced through `reservations/page.tsx:376` → `api/properties/route.ts` → `property-service.ts:117`'s `if (error || !data) return []`. Not a swallowed exception, wrong table, wrong schema, stale deployment, or env var issue — confirmed by direct inspection of all four layers. Fix: replaced the false diagnostic text in two files with accurate wording ("No rooms or halls have been configured yet... add inventory_items"):
- `src/app/(crm)/reservations/page.tsx:462`
- `src/app/(crm)/reservations/calendar/page.tsx:254-256`
No logic, query, or architecture changes — text only. TypeScript: 0 errors (confirmed, full project). ESLint: could not complete in this sandbox (repeated timeouts on this specific tool run, environment-side — `ps aux` showed no stuck process, likely a cold-start/config-load delay). Given the change is a static JSX text-node replacement only (no new imports/variables/logic), and both files passed a full clean ESLint run earlier this same session, risk is low — but not independently re-confirmed. **Recommend Raju runs `npm run lint` locally for authoritative confirmation before considering this fully verified**, consistent with "never assume success."
