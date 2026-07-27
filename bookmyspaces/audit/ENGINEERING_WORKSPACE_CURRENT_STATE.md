# Engineering Workspace — Current State

**Purpose of this document:** a factual snapshot of the workspace as it exists in the repository today, with gaps and recommendations only. This is not a redesign — the stack, layering, and module boundaries below are already in production and are being described, not proposed.

---

## 1. Stack (as-built)

Next.js 14 App Router, TypeScript (strict), Supabase/Postgres, Tailwind, deployed on Vercel. `src/lib/` holds all business-logic services (leads, reservations, conversations, pricing, proposals, admin/catalog); `src/app/api/` is a thin HTTP layer over those services (auth guard → zod validation via `src/lib/validation.ts` → service call → shaped response); `src/app/(crm)/` is the operator-facing UI. This layering is consistent and already followed by every module audited this session (Reservation Platform, Chat/Unified Conversation Platform) — no gap here.

## 2. Test tooling

**Gap — real, not hypothetical:** `node_modules` in this connected folder only carries Windows-platform native binaries for `rollup` and `esbuild` (`@rollup/rollup-win32-x64-*`, `@esbuild/win32-x64`). Any Linux dev/CI environment pointed at this exact `node_modules` (not `package.json` — that's fine) cannot run `vitest` at all until `npm install` regenerates platform-correct binaries. This session worked around it by pulling the Linux binaries directly from the npm registry into `node_modules` — a sandbox-local fix, not a repo fix. **Recommendation:** confirm CI (if any exists) runs `npm ci` fresh rather than reusing a committed/cached `node_modules`; if `node_modules` is ever synced between a Windows machine and a Linux CI runner directly, this will recur.

**Coverage reality:** 5 reservation test files (40 tests) + 2 more added this session (47 total) are real and passing, all fully mocked — none have ever executed against a live Postgres instance, because no engineering session on this project (across all the ones referenced in `audit/`) has had network access to the production Supabase project. The Unified Conversation Platform (`unified-conversation-service.test.ts`, `context-builder.test.ts`) is in the same position. **This is not a code-quality gap — the code and tests are good — it's a verification gap**: nothing has been proven against real data or real Postgres constraint behavior (FKs, RLS, generated columns) yet.

## 3. Build/lint tooling

**Gap:** `next build` and `next lint` are unreliable in at least this sandbox environment — confirmed hanging with no output across two separate sessions, weeks apart, ruling out a one-off fluke. `GO_NO_GO_DECISION_REPORT.md`'s blocker B3 ("`npm run build` never confirmed to complete") is still open as of this document. **Recommendation:** get one confirmed, logged `npm run build` pass from a real developer machine or CI runner (not this sandbox) before the next production deploy, and keep that log — this is the single easiest blocker on the list to close and the one most worth closing first, since an unconfirmed build is a deploy-time risk regardless of how good the code review process is.

## 4. Version control

**Gap, already flagged in `CURRENT_STATUS.md` (2026-07-12) and still true today:** this connected folder has no `.git` directory. Every engineering session working in this folder — including this one — can edit files but cannot commit, branch, diff, or push. All commits/deploys have to happen from wherever the actual git remote is checked out, which is outside any AI session's reach. **Recommendation:** if AI-assisted sessions are expected to continue working directly in this folder, either connect it to the real repo (so changes are diffable/committable in place) or adopt an explicit "patch/diff handoff" convention so nothing gets silently lost between a session's edits and the next real commit.

## 5. Schema-vs-migration drift

**Gap, already documented in `LIVE_SCHEMA_AUDIT.md` (2026-07-11):** several live tables (`invoices`, `messages`, `payments`, `user_profiles`, `whatsapp_conversations`, `whatsapp_messages`) exist in production but are not defined in any migration file — they were created directly, then backfilled into migration 009 as documentation after the fact. One migration-defined view (`leads_needing_followup`) does not exist live at all. This is a known, contained issue (009 exists specifically to close it) but worth restating: **treat migration files as the design record, not as proof of the live schema, until this gap is fully closed.**

## 6. RLS posture

**Gap, already documented in `LIVE_SCHEMA_AUDIT.md`:** RLS is enabled on 19 of 22 live tables, but most `authenticated`-role policies are unscoped (`USING (true)`) — any logged-in user can read/write any row of those tables. This is a deliberate, already-made trade-off (authorization lives at the API layer via `requireAuth()`/`requireRole()`, not in RLS) that migration 012's new tables continue consistently (`service_role`-only policies, no direct authenticated-user table access at all). Not a regression, but worth a single explicit note: **this architecture depends on every route remembering to call `requireAuth()`/`requireRole()` — RLS is not a backstop here.**

## 7. Environment/secrets

**Gap, already flagged in `CURRENT_STATUS.md` and `GO_NO_GO_DECISION_REPORT.md` (blocker B2):** `WHATSAPP_APP_SECRET` was found missing from `.env.local` as of the last direct check, leaving the WhatsApp webhook route unauthenticated. Not re-verified this session (no network access to confirm current production env state). **Recommendation:** confirm this is set in the real Vercel project's environment variables before relying on the WhatsApp channel in production, if not already done.

## 8. What is NOT a gap (stated explicitly, since this document's job is to avoid re-litigating settled things)

- The `leads`-as-customer-record decision (no parallel `customers` table) — settled 2026-07-13, consistently implemented everywhere including migration 012's FKs.
- The additive-only, no-big-bang migration discipline — every migration reviewed this session and prior sessions follows it (`IF NOT EXISTS` throughout, old tables never dropped).
- The service-layer/API-layer/UI-layer separation — consistent across every module.
