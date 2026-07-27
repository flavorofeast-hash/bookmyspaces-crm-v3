# Security Review — BookMySpaces CRM V3

Produced during the Release Candidate hardening pass. Covers Authentication, Authorization, Input validation, SQL/filter injection, XSS, CSRF, Secrets, Service-role key usage, API permissions, Rate limiting, Webhook verification, Logging, and Error handling. Every issue found is listed; safe ones were fixed in place (see diffs in this pass), unsafe-to-change-blind ones are documented as accepted risk with reasoning.

## Authentication & Authorization

- Every CRM-facing route (leads, proposals, reservations, packages, campaigns, customers, dashboard, settings, etc.) goes through `requireAuth()` or `requireRole()` (`src/lib/auth-guard.ts`), backed by Supabase session cookies (`@supabase/ssr`).
- **Architectural note carried forward from `audit/ENGINEERING_WORKSPACE_CURRENT_STATE.md`, still true and worth restating here:** RLS is enabled on most live tables, but most `authenticated`-role policies are unscoped (`USING (true)`) — authorization is enforced at the API layer via `requireAuth()`/`requireRole()`, not by RLS row-scoping. This is a deliberate, consistent architectural choice (migration 012's newer tables continue it with `service_role`-only policies), not a regression — but it means **this codebase's security model depends on every route remembering to call the auth guard**. RLS will not catch a route that forgets to. Worth keeping in mind for code review discipline on any future route additions.
- `src/app/api/leads/import/route.ts` checks `supabase.auth.getSession()` manually instead of via the shared helper — functionally equivalent (401 if no session), just inconsistent with the rest of the codebase. Low-priority style nit, not a hole.
- `UserMenu` (session-aware sign-out UI) was built but not mounted anywhere — activated into `CRMLayout.tsx` this pass (Phase 1). Not a security gap by itself, but meant operators had no visible way to confirm which account they were signed in as.

## Public-by-design routes (verified, not bugs)

These are intentionally unauthenticated. Each has its own protection mechanism instead of session auth:

| Route | Why public | Protection |
|---|---|---|
| `/api/proposals/[id]/preview`, `/api/proposals/[id]/pdf` | Read by both logged-in operators and anonymous customers holding a share link | UUID `id` acts as a capability token; no session required by design |
| `/api/proposals/share/[token]` | Customer-facing proposal view | `share_token` (UUID) capability token; read-only — no POST/PATCH exists on this route, confirmed by grep |
| `/api/whatsapp/webhook` | Meta Cloud API delivery endpoint | `verifySignature()` HMAC check against `WHATSAPP_APP_SECRET`; **rate-limited this pass** (was previously signature-only, see below) |
| `/api/social/webhook/[platform]` | Meta/Instagram webhook delivery | Per-platform `adapter.verifyWebhook()` HMAC check + `checkRateLimit` (120 req/60s per IP) — already had both |
| `/api/chat` | Public website chatbot | No auth needed (public marketing site feature); rate-limited (20 msg/min per IP), input length-capped at 2000 chars |
| `/api/cron/*` (4 routes) | Vercel Cron invocations | `CRON_SECRET` bearer-token check — **see finding below, this one has a real gap** |

## Findings

### 1. Fixed — WhatsApp webhook had no rate limiting (now added)
`src/app/api/whatsapp/webhook/route.ts` had signature verification but no rate limit, unlike its sibling `/api/social/webhook/[platform]`. Matters most as a backstop for the case below (#2), where the signature check itself can be silently disabled. Added `checkRateLimit` (120 req/60s per IP), reusing the existing `src/lib/rate-limit.ts` infra — no new dependency.

### 2. Accepted risk — WhatsApp signature check fails open if `WHATSAPP_APP_SECRET` is unset
`verifySignature()` returns `'unconfigured'` when the secret isn't set, and the route only *warns* (`logger.warn(...ISS-004...)`) rather than rejecting. This is pre-existing, documented behavior (its own log line references `ISS-004`), not introduced this pass. **Must-set item for the deployment checklist** — without this env var, any party can POST forged webhook payloads.

### 3. Real gap, fixed — Cron routes fail open with no auth if `CRON_SECRET` is unset
```ts
const cronSecret = process.env.CRON_SECRET
if (cronSecret) {
  // ...token check...
}
// falls through to running the cron job with ZERO auth if cronSecret is undefined
```
Same fail-open shape as #2, across all 4 cron routes (`campaign-queue`, `followups`, `journey`, and one more — grep-confirmed identical pattern). Not changed in code this pass (changing the fail-open default to fail-closed risks breaking legitimate Vercel Cron invocations if the secret isn't wired up yet in every environment) — instead flagged as a **must-set environment variable** in the deployment checklist, same as #2. This is the safer fix: enforce via deployment checklist + a documented requirement, not a code change that could lock out cron jobs mid-migration.

### 4. Fixed — Filter-injection risk in two `.or()` query-builder call sites
PostgREST's `.or()` filter syntax treats `,` and `()` as clause-separator/grouping syntax, not literal characters. Two call sites interpolated unsanitized text into that filter string:
- `src/app/api/leads/route.ts` — the `search` query param (route is behind `requireAuth()`, and `getSupabaseAdmin()` already bypasses RLS for this table regardless, so this was a correctness/defense-in-depth issue, not a data-exposure one).
- `src/lib/ai.ts` (`retrieveRelevantKnowledge` / `retrieveFromKnowledgeSources`) — keywords derived from **raw customer chat text**, reachable from the public `/api/chat` route with no session. This one had real reach: an attacker could shape a chat message so one "word" (no spaces) contained `,` or `()` and inject extra `.or()` clauses. Blast radius was still low — the queried tables (`knowledge_chunks`, `knowledge_sources`) hold public FAQ-style content, not PII — but it's a genuine unauthenticated injection vector.

Both fixed by stripping `,` and `(`/`)` from the interpolated values before building the filter string. Verified via `esbuild` (0 errors) after the fix.

### 5. Fixed — Two remaining unescaped fields in the proposal PDF generator
`src/lib/proposal-pdf.ts` claims (in its own header comment, from an earlier "Version 1.0 XSS fix") full HTML-escaping of customer/room/add-on/package fields, but `r.room_type` and `a.name` were still interpolated raw in `accomRowsHtml`/`addonsRowsHtml`. Both wrapped in the file's existing `escapeHtml()` helper. This is a real stored-XSS gap in a route two different audiences load (operators and anonymous customers via share link), found by not trusting the code's own claim of completeness at face value — cross-checked against the actual interpolation sites.

### 6. Fixed — PII (phone numbers) leaking into log message strings
`src/lib/logger.ts` only redacts `phone`/`email`/`name` keys **inside the `data` object** of a log call, not text interpolated into the message string itself. Found and fixed ~9 call sites across `whatsapp/webhook/route.ts`, `process-inbound.ts`, and `whatsapp/send-message.ts` where phone numbers were embedded directly in message strings (e.g. `` `Failed for ${from}` ``) instead of passed via `{ phone: from }`. Covered in Phase 1's audit, cross-referenced here since it's a logging-hygiene security item, not just a cleanliness one.

### 7. Non-issue, documented — `/api/proposals/[id]/pdf` and `/preview` have no auth guard
Confirmed via grep that both routes are called from the authenticated operator UI (`proposals/page.tsx`) **and** the anonymous customer share page (`proposals/share/[token]/page.tsx`) with the *same* URL shape (`/api/proposals/${proposal.id}/pdf`). Adding `requireAuth()` here would break the legitimate customer flow. The UUID `id` is the de facto capability token — same pattern as the share-token route. Accepted, not a fix candidate; flagged for awareness in case a future change (e.g. sequential IDs) is ever considered, which would break this assumption.

### 8. Non-issue — `ai-summary/route.ts` is a dead stub
Checked as a possible AI-cost-abuse vector (unauthenticated route that could trigger paid API calls in a loop). It isn't — both `GET` and `POST` are 3-line stubs returning `{ ok: true, route: 'ai-summary' }` with no AI call, no DB access, nothing to abuse. This should really have surfaced in Phase 1's dead-code sweep; noting it here since it was found during this phase instead. Safe to leave as-is (a stub returning 200 is harmless) or delete in a future cleanup pass — not a production blocker either way.

### 9. Non-issue, verified — `notifications/route.ts`
Both `GET` and `PATCH` correctly call `getCurrentUser()` and return 401 if absent, and every query is scoped `.eq('user_id', user.id)` — no cross-user data access possible. Converted its 4 `console.error` calls to the structured `logger` module for consistency with the rest of the codebase (no PII in these particular log lines, so this was a consistency fix, not a redaction fix).

## SQL injection

No raw/string-built SQL anywhere in `src` — every query goes through the Supabase JS client's parameterized query builder (`.eq()`, `.in()`, `.gte()`, etc.) or `.rpc()` with a named function and a structured params object (3 call sites: `track_event`, `match_knowledge_chunks` ×2 — all pass typed objects, no string concatenation into the RPC name or params). The `.or()` filter-string sites (finding #4) are a different, lower-severity class of issue (PostgREST filter-clause injection, not SQL injection — Supabase still parameterizes the underlying SQL), already fixed.

## Secrets & environment variables

No hardcoded API keys, service-role keys, or `sk-`-prefixed secrets found in `src` (grepped for common patterns — zero matches). `src/lib/env.ts` centralizes env var access; its one `console.warn` is a legitimate startup-banner pattern (lists which optional integrations are configured), not a leak — reviewed in Phase 1 and left as-is.

## CSRF

`next.config.js` restricts Server Actions to `allowedOrigins: ['bookmyspaces.in', 'www.bookmyspaces.in', '*.vercel.app', localhost]` — confirmed present. Combined with Supabase's cookie-based session auth (SameSite-protected by default) and the fact that all mutating API routes require a session, standard CSRF exposure is low. No additional CSRF token layer exists beyond this, which is a reasonable, common posture for a Next.js App Router app of this shape (not flagged as a gap).

## Webhook verification — summary

**Correction, Go-Live pass (2026-07-27):** the line originally here claimed both webhooks fail open if their secret is unset. Re-reading `src/lib/social/adapters/meta-adapter.ts` directly during Go-Live Phase 6 found that claim wrong for the Social webhook — corrected below. This is exactly the kind of claim the Go-Live directive says not to take on trust, including this document's own prior claims.

| Webhook | Mechanism | If secret env var unset | Rate-limited |
|---|---|---|---|
| WhatsApp (`/api/whatsapp/webhook`) | HMAC (`X-Hub-Signature-256` via `WHATSAPP_APP_SECRET`) | **Fails open** — logs a warning, still accepts and processes the request | Yes (added RC pass) |
| Social (`/api/social/webhook/[platform]`) | Per-platform HMAC via adapter's `verifyWebhook()` (`META_APP_SECRET` for Facebook/Instagram) | **Fails closed** — `verifyWebhook()` returns `false` when the secret is missing, route responds `401` | Yes (pre-existing) |

Only WhatsApp is a live risk if its secret is left unset — the Social webhook simply won't accept any traffic until `META_APP_SECRET` (and the other `META_*` variables) are configured, which is the safe failure direction. `WHATSAPP_APP_SECRET` remains the one must-set item here.

## Summary of code changes made this pass

1. `src/app/api/whatsapp/webhook/route.ts` — added rate limiting (120 req/60s/IP), matching the social webhook.
2. `src/app/api/leads/route.ts` — sanitized `search` param before building `.or()` filter.
3. `src/lib/ai.ts` — sanitized chat-derived keywords before building `.or()` filter (two call sites share the fix).
4. `src/lib/proposal-pdf.ts` — closed the two remaining unescaped XSS interpolation sites (`room_type`, add-on `name`).
5. `src/app/api/notifications/route.ts` — converted `console.error` to structured `logger`.
6. (Phase 1, cross-referenced) ~9 logger call sites across WhatsApp modules — moved phone numbers out of interpolated message strings into redacted `data` objects.

## Items for the deployment checklist (not code changes)

- `WHATSAPP_APP_SECRET` must be set in production — without it, webhook signature verification silently no-ops.
- `CRON_SECRET` must be set in production — without it, all 4 cron routes run with zero authentication.
