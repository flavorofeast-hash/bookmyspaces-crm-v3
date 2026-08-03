# RC2 Production Hardening — Technical Debt Report

Date: 2026-08-02
Scope: full repository static audit (`src/`, `supabase/migrations/`), no runtime execution (sandbox unavailable this session — see Methodology).

## Methodology

This is a targeted static audit, not a line-by-line read of every file. The codebase has ~300 files under `src/`. Findings below come from: (1) structural pattern search (ripgrep-equivalent) across the whole tree for each category in the mission brief — duplicate formatters, `any` usage, empty catches, auth-guard presence, dangerous sinks (`eval`, `dangerouslySetInnerHTML`, raw SQL interpolation) — which has effectively 100% file coverage for "does this pattern appear," and (2) full reads of every file a pattern search flagged as a likely finding, to confirm it before reporting it. No linter/type-checker/bundler was run to produce this report (the sandbox needed to execute `tsc`/`eslint`/`next build` was unavailable — see the Verification section of this session). Two items below (`any` count, duplicate-formatter count) are therefore grep-based approximations, not compiler-verified.

I did not attempt exhaustive line-by-line review of business logic inside all 76 API routes or all ~150 `src/lib` files — the security section specifically covers *authentication/authorization coverage* (which pattern-searches reliably) and known dangerous patterns, not a full logic review of every endpoint.

---

## Findings by category

### 1. Duplicate utility functions

- `fmtINR`/`fmtDate`-equivalent currency/date formatting logic appears independently in 20–36 files (varies by exact pattern: `₹` string building in ~20 files, `toLocaleDateString('en-IN', ...)` in ~19 files, `toLocaleString('en-IN', ...)` in ~36 files). A subset (the two Lead Details/Customer Profile pages) was already consolidated into `src/lib/format.ts` in the previous session. The remaining occurrences span PDF generation (`proposal-pdf.ts`), email templates, AI prompt-building (`scoring.ts`, `ai-summary.ts`), dashboards (founder/marketing/revenue/intelligence/chief-of-staff), and several API routes that format numbers into response strings.
- Phone normalization is centralized already (`src/lib/whatsapp/normalize-phone.ts`) — good, no duplication found there.
- No duplicate array/string/validation helpers were found as distinct standalone functions; validation is centralized in `src/lib/validation.ts` (Zod schemas), which is the correct existing pattern.

### 2. Duplicate React components

- `Section`/`Label`/`Input`/`SelectField` form primitives are declared identically (or near-identically) in both `src/app/(crm)/proposals/new/page.tsx` and `src/app/(crm)/visits/new/page.tsx` — same props, same Tailwind classes, same structure.
- Loading-spinner markup (`<RefreshCw className="animate-spin" />` + "Loading…" text) is repeated inline in 26 files rather than a shared `<LoadingState />` component.
- Status/stage badge styling (colored pill spans keyed by a status/stage/temperature enum) is redeclared per-page in at least Kanban, Customer Profile, Lead Workspace, Reservations, and the dashboards — each with its own `Record<string, string>` color map, sometimes for the *same* enum (`LeadStage` color mapping exists in both `src/modules/leads/types.ts` as the canonical `STAGE_PIPELINE` and, historically, as a second hand-copied version inside `kanban/page.tsx` — the Kanban copy is a byte-for-byte duplicate of `STAGE_PIPELINE`/`STATUS_TO_STAGE`/`effectiveStage`, already called out in that file's own comments as something that should import from `types.ts` instead).
- Timeline/Proposals/AI Assistant panel duplication (Customer Profile vs. Lead Details) was already resolved last session by extracting `src/components/leads/{LeadTimeline,LeadProposals,AIAssistantPanel}.tsx`.

### 3. Unused code

- **`src/components/layout/CRMShell.tsx` is entirely dead.** It is never imported or rendered anywhere in the app — the one layout actually wired in is `CRMLayout.tsx` (via `src/app/(crm)/layout.tsx`). `CRMLayout.tsx`'s own comments confirm this explicitly: CRMShell "had a sign-out button but pointed at a `/api/auth/signout` URL that doesn't exist." Confirmed via search: the only references to `CRMShell` in the whole repo are the file itself and that one explanatory comment.
- **Two orphaned API route files with wrong filenames**, previously identified and explicitly marked for deletion by whoever last touched them:
  - `src/app/api/leads/[id]/stage/lead-stage-route.ts` — header comment: "SUPERSEDED... this file is never loaded by the router (wrong filename) and can be deleted."
  - `src/app/api/proposal/share/[token]/api--proposal--share--token--route.ts` — identical situation.
  Both sit next to the real, correctly-named `route.ts` in the same folder and are confirmed to have zero imports anywhere in the codebase.
- **Leftover debug instrumentation**: `src/app/api/leads/import/route.ts` contains a block explicitly commented `// ─── TEMP DEBUG — remove before final commit ───` that logs the first parsed lead row on every import. Self-contained, no downstream consumer.
- A full unused-export/unused-type sweep needs an actual tool (`ts-prune`, `knip`, or `eslint --no-eslintrc --rule 'no-unused-vars'`) run against the compiled project — I could not run one this session (see Methodology). This report's unused-code findings are limited to what a targeted search plus manual confirmation could establish with certainty.

### 4. Dead routes

- Cross-referenced all `(crm)` `page.tsx` files against `CRMLayout.tsx`'s nav array (23 links) and every secondary in-page link I could find. Everything resolves to either a direct nav entry, a dynamic detail route reached by clicking a row (leads/[id], customers/[id], reservations/[id]), a sub-flow reached by an in-page button (proposals/new, visits/new, dashboard/leads/import), or a secondary in-page link (`reservations/calendar` is linked from `reservations/page.tsx`, not from the main nav, but is reachable). No page was found with zero inbound links.
- No API route was found with zero call sites via grep for its path string across `src/` — this doesn't rule out routes only called from outside the repo (e.g., a Vercel cron config, a third-party webhook config, or a browser bookmark), which a static search can't see.
- The two orphaned route files in §3 are "dead" in the sense of being unreachable by the framework (wrong filename), not in the sense of an unused live endpoint.

### 5. TypeScript cleanup

- `: any` / `as any` appears 91 times across 32 files (grep count, not compiler-verified — some may be in `.test.ts` files where `any` is more defensible for mocking). Heaviest concentrations: `proposal-pdf.ts` (11), `analytics/route.ts` (9), `sheets.ts` (8), `kanban/page.tsx` (8), `invoice/route.ts` (8), `health/route.ts` (7).
- Duplicate/near-duplicate interfaces exist for the same conceptual entity: `Customer` (in `customers/[id]/page.tsx`) and `Lead` (`src/modules/leads/types.ts`) describe overlapping but not identical shapes of the same `leads` database row, maintained by hand in two places. `TimelineEntry`/`CustomerTimeline` used to be redeclared a second time in `customers/[id]/page.tsx` instead of importing the canonical `src/types/timeline.ts` versions — this was fixed last session as part of the component extraction.
- No duplicate enums were found (the codebase mostly uses string-literal union types rather than TS `enum`, which is otherwise a reasonable convention).

### 6. Performance

- **Duplicate/uncached fetches**: every CRM page (Customer Profile, Lead Workspace, Kanban, Reservations, Dashboards) hand-rolls its own `useState`/`useEffect`/`fetch` data loading with no shared caching layer — there is no `src/hooks/` directory and no data-fetching library (SWR/React Query) in use despite this being a very common pattern across 15+ pages. Practically: navigating away and back to the same lead re-fetches everything from zero every time, and pages that show overlapping data (e.g., Kanban and the Dashboard both list leads) never share a cache.
- **Kanban's dead `leadContext` state** (found in the previous Lead Workspace audit) is a performance-adjacent bug, not just dead code: the component re-renders on every keystroke in the note input because the input isn't debounced and there's no local uncontrolled-input isolation — minor, but worth folding into any future Kanban touch-up.
- No `useMemo`/`useCallback` misuse was found causing measurable re-render storms in the files inspected; this needs a React DevTools profiler pass in a running app to say anything more concrete than "no shared cache."
- Bundle size: no route-level code-splitting issues found by inspection; `next build`'s own output (not run this session) is the authoritative source for actual bundle sizes per route.

### 7. Security

- **Every one of the 76 `src/app/api/**/route.ts` files was checked for an authentication/authorization gate.** All either call `requireAuth()` (51 files), `requireRole([...])` (9 files, admin/manager-only endpoints), a route-specific session check via `getCurrentUser()`/`supabase.auth.getSession()` (`notifications/route.ts`, `leads/import/route.ts`), a `CRON_SECRET` bearer-token check (the four `cron/*` routes), or are intentionally public with a stated reason in-code (`whatsapp/webhook`, `social/webhook/[platform]` — verified via `verify-signature.ts`; `chat/route.ts` — public customer-facing chatbot; `health/route.ts`; `proposals/track-view/route.ts` — public proposal-view pixel; `proposal/share/[token]/route.ts` — intentionally public, token-gated). **No route was found with a total absence of any gate.** (My first pass of this check produced false positives by grepping only for the literal string `requireAuth`, missing routes that correctly use `requireRole` or a route-specific session check instead — corrected before writing this up.)
- **Authorization model risk (structural, not a bug)**: nearly the entire app (136 files, 321 call sites) reads/writes the database via `getSupabaseAdmin()`, the service-role client that bypasses Postgres RLS entirely. This is a deliberate, documented architecture choice (RLS is not the enforcement boundary; the per-route `requireAuth`/`requireRole` calls are), but it means there is **no defense in depth** — if a future route is added without remembering to call one of those two functions, there is nothing else stopping an unauthenticated request from reading or writing any row in any table. Recommend a lint rule or a pre-commit/CI check that fails if a new `route.ts` under `src/app/api/` doesn't reference `requireAuth`, `requireRole`, `CRON_SECRET`, or an explicit `// PUBLIC:` comment marker.
- No raw SQL string interpolation, `eval`, `new Function`, or `dangerouslySetInnerHTML` was found anywhere in `src/`.
- One pre-existing, already-documented defensive fix was noted (not new): `src/app/api/leads/route.ts` strips `,` and `()` from user search input before building a PostgREST `.or()` filter string, specifically to prevent filter-clause injection — this is good practice already in place, flagged here only as evidence the team is already thinking about this class of issue.
- Did not audit third-party webhook signature-verification *logic* itself (`verify-signature.ts`) for correctness — confirmed it exists and is called, did not re-derive whether the HMAC comparison is timing-safe or whether the Meta/WhatsApp secret rotation story is sound. Recommend a focused review of that one file given webhooks are a common attack surface.

### 8. Error handling

- **Two literal empty catch blocks** (`catch {}` with no body at all): `src/lib/ai.ts` and `src/app/(crm)/kanban/page.tsx`. Both silently discard the error with no logging — a genuine debugging hazard if either ever fails in production.
- **22 `.catch(() => null)` / `.catch(() => {})` occurrences across 9 files** — deliberately fire-and-forget error suppression (e.g., "don't block lead creation if the welcome WhatsApp message fails to send"). Several of these are explicitly and correctly commented as intentional non-fatal fallbacks (e.g., `runAutoPackageRecommendation(lead.id).catch(() => null)` in `leads/route.ts`, which has a comment explaining it's self-gated and must never block lead creation) — those are fine as-is. Others have no comment explaining the decision, which makes it impossible to tell "intentionally non-fatal" from "someone silenced an error and moved on" during a future review. Recommend: every silent catch should at minimum call `logger.warn(...)` so failures are visible in logs even when they're correctly non-blocking for the user.
- `console.log`/`console.error` used directly (bypassing the shared `logger`) in 7 files, meaning those errors don't get whatever structured formatting/redaction `src/lib/logger.ts` provides to everything else.
- Generic error messages (`{ error: 'Failed to X' }` with the underlying error only in server logs, never returned to the client) are the dominant, consistent pattern across API routes — this is intentional and correct (don't leak internals to the client) and is not a debt item, noted for completeness.

### 9. Folder structure (recommendations only — nothing moved)

- `src/lib/`, `src/modules/`, and `src/services/` all currently hold business logic with no clear, written boundary between them. Examples: lead-stage transition logic lives in `src/modules/leads/`, follow-up scheduling logic lives in `src/modules/followups/`, but closely related lead-qualification and package-recommendation logic lives in `src/lib/leads/` and `src/lib/whatsapp/`, and inbound WhatsApp processing lives in a third location, `src/services/whatsapp/`. A new contributor has no way to predict which of the three a new piece of domain logic belongs in. Recommend documenting (in a `CONTRIBUTING.md` or the root `README.md`) a rule such as "`modules/` = stateful domain workflows with their own types; `lib/` = stateless integrations and pure helpers; `services/` = inbound webhook/channel processors" — or, if that distinction doesn't actually hold up under scrutiny, consolidating two of the three into one directory in a dedicated, reviewed migration (not part of this pass).
- `src/app/(crm)/dashboard/leads/[id]/page.tsx` (Lead Workspace) and `src/app/(crm)/customers/[id]/page.tsx` (Customer Profile) are two different URLs rendering increasingly similar content against the same underlying `leads` row (documented in `LEAD_WORKSPACE_AUDIT.md` and `LEAD_WORKSPACE_DESIGN_PLAN.md` from the previous session). This isn't a folder-structure problem per se, but it's the same "two names for one concept" pattern showing up in the URL structure as well as the type system (§5). Worth a product decision on whether both screens should keep existing long-term, out of scope for this hardening pass.
- No `src/hooks/` directory exists despite 15+ pages independently reimplementing the same fetch/loading/error `useState` triad (§6). Introducing one shared `useResource()`-style hook would reduce duplication significantly, but is a behavior-touching change (however small) across many files — explicitly out of scope for a "no runtime behavior change" pass; recommended as a follow-up.

---

## Prioritized technical debt list

| # | Item | Severity | Effort | Risk to fix | Included in this pass? |
|---|---|---|---|---|---|
| 1 | Two orphaned wrong-filename route files (`lead-stage-route.ts`, `api--proposal--share--token--route.ts`) | High | Trivial (delete 2 files) | Very low — confirmed zero references, already marked for deletion in their own header comments | Yes |
| 2 | `src/components/layout/CRMShell.tsx` entirely dead/unused | High | Trivial (delete 1 file) | Very low — confirmed zero imports anywhere | Yes |
| 3 | TEMP DEBUG logging block in `leads/import/route.ts`, self-marked "remove before final commit" | High | Trivial (delete ~10 lines) | Very low — self-contained, no downstream consumer | Yes |
| 4 | No CI/lint guard ensuring every new API route has an auth gate | High | Small (add a lint rule or CI script) | Low, but requires a new tooling script — deferred | No — recommend as immediate follow-up |
| 5 | Empty catch blocks in `ai.ts` and `kanban/page.tsx` swallow errors with zero logging | Medium | Trivial (add `logger.warn`) | Low, but touches business logic files outside this session's already-verified diff — deferred to keep this pass minimal | No — recommend as immediate follow-up |
| 6 | Duplicate `Section`/`Label`/`Input`/`SelectField` primitives (`proposals/new`, `visits/new`) | Medium | Medium (extract shared form-primitives file, update 2 live pages) | Medium — touches two staff-facing forms; needs a full visual re-check | No — recommend as a dedicated follow-up PR |
| 7 | Kanban's `STAGE_PIPELINE`/`STATUS_TO_STAGE`/`effectiveStage` are a hand-copied duplicate of `src/modules/leads/types.ts`'s canonical versions | Medium | Small (swap 3 local consts for an import in one file) | Low-medium — Kanban is a high-traffic page; needs a careful diff review even though it's mechanically simple | No — recommend as a dedicated follow-up PR |
| 8 | Widespread currency/date formatting duplication beyond what's already centralized (~20-36 files) | Medium | Large (many files, some inside PDF/email-generation logic where formatting differences could be visible to customers) | Medium-high given the scale — deferred entirely | No |
| 9 | 91 `any`/`as any` occurrences across 32 files | Medium | Large (real typing work, file by file) | Varies per file — deferred entirely | No |
| 10 | Two parallel "lead status" models (`status` legacy enum vs. `lead_stage` state machine) coexisting via a bootstrap shim | Medium | Large (would touch schema-adjacent code across many files) | High — explicitly a "don't touch without a dedicated migration plan" item | No |
| 11 | Silent `.catch(() => null)` sites without explanatory comments (subset of the 22 found) | Low | Small per-site | Low, but requires case-by-case judgment on which need a comment vs. a log line | No |
| 12 | `console.log`/`console.error` bypassing the shared logger in 7 files | Low | Small | Low, but out of the already-verified diff for this session | No |
| 13 | No shared data-fetching hook; every page reimplements fetch/loading/error state | Low | Large (introduces a new abstraction used everywhere) | Medium — behavior-adjacent even if "just a refactor" | No |
| 14 | `lib`/`modules`/`services` boundary undocumented | Low | Small (write a doc) / Large (if consolidated) | Low for docs, high for consolidation | No — doc-only recommendation |

---

## What was actually implemented in this pass

Per the mission's explicit scope ("implement ONLY low-risk, behavior-preserving refactors"), only items **#1, #2, #3** from the table above were executed — the three changes with confirmed zero inbound references and explicit "safe to delete" markers already left in the code by a previous engineer. Everything else is documented above for a future, separately-reviewed pass, in priority order.
