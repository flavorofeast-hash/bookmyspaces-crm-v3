# Production Security Audit — BookMySpaces CRM

Read-only. All findings independently verified by reading exact source (no
finding reported on agent-summary trust alone). No code modified.

## High

### H1 — Deactivating a user does not revoke their session
**File:** `src/lib/auth-guard.ts:28-65` (`requireAuth`, `requireRole`); `src/app/api/admin/users/route.ts:73-83` (`deactivate` action)
`requireAuth()` only calls `getCurrentUser()` (valid/unexpired JWT check). `requireRole()` additionally queries `user_profiles` but selects only `role`. Neither checks `is_active`. `PATCH /api/admin/users {action:'deactivate'}` only flips that column — no `supabase.auth.admin.signOut()` or token revocation.
**Exploit:** Admin deactivates a terminated or compromised staff account. The employee's existing browser session (auto-refreshed by `src/middleware.ts` on every navigation) keeps passing every `requireAuth()`/`requireRole()` check indefinitely — full continued access to leads, customers, proposals, payments, reservations, and `/api/admin/*` if they held admin/manager role. Offboarding is a no-op from a data-access standpoint.
**Fix:** Have `requireAuth()`/`requireRole()` select and check `is_active`; reject with 401/403 when false. Also call `supabase.auth.admin.signOut(userId, 'global')` in the `deactivate` action for defense-in-depth.

### H2 — `invoices`/`payments` RLS policies grant any authenticated user full read/write on all financial records
**File:** `supabase/migrations/009_document_undocumented_production_objects.sql:151-153` (`auth_invoices`), `:179-181` (`auth_payments`)
```sql
CREATE POLICY "auth_invoices" ON invoices FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "auth_payments" ON payments FOR ALL USING (auth.role() = 'authenticated');
```
`auth.role() = 'authenticated'` is true for **any** logged-in Supabase user regardless of app-level role (sales/marketing/manager/admin) — it bypasses the Next.js app's `requireRole()` authorization entirely.
**Exploit:** Any staff member (e.g. a `marketing`-role account with no legitimate reason to see payments) calls the Supabase REST API directly with `NEXT_PUBLIC_SUPABASE_ANON_KEY` + their own session JWT: `GET {SUPABASE_URL}/rest/v1/invoices?select=*` / `payments?select=*` — returns every customer's invoice and payment records across the entire business, and can `PATCH`/`DELETE` them too.
**Fix:** Replace with policies scoped to actual roles, e.g. `USING (auth.role() = 'authenticated' AND (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin','manager'))`, or move all invoice/payment access behind `service_role`-only RLS and require every read/write to go through the already-role-checked API routes.

### H3 — WhatsApp webhook processes forged requests when `WHATSAPP_APP_SECRET` is unset
**File:** `src/app/api/whatsapp/webhook/route.ts:68-75`, `src/lib/whatsapp/verify-signature.ts`
```ts
if (signatureCheck === 'unconfigured') {
  logger.warn(...)               // logs only
} else if (signatureCheck === 'invalid') {
  return new NextResponse('Forbidden', { status: 403 })
}
// falls through to full processing in both the 'unconfigured' and 'valid' cases
```
**Exploit:** If `WHATSAPP_APP_SECRET` is unset/lost on a redeploy or env-var misconfiguration, `POST /api/whatsapp/webhook` with an arbitrary fabricated payload (no signature header needed) is processed as if genuine — triggers real outbound Meta API sends (`sendWhatsAppText`, real cost, can harass arbitrary phone numbers under attacker control), creates/updates `leads`/`conversations`, runs AI qualification. Only a 120 req/min **per-instance** IP rate limit bounds it.
**Fix:** Fail closed — if `WHATSAPP_APP_SECRET` is unset in production (`NODE_ENV === 'production'`), reject with 500, don't process.

### H4 — WhatsApp inbound default path has zero replay protection
**File:** `src/app/api/whatsapp/webhook/route.ts:158-180` (`runLegacyReplyPath`) — this is the active default: `orchestrationSettings.enabled` defaults to `false` (`src/lib/settings/settings-service.ts:129`), and even when enabled it falls back to this same unguarded path on any internal error (`route.ts:134-145`). The only dedup check in the file (`handleIncomingMessageViaOrchestration`, `route.ts:196-213`, keyed on `unified_messages.external_message_id`) is unreachable on the default path.
**Exploit:** An attacker who captures one valid, correctly-signed webhook delivery (compromised logging pipeline, unencrypted proxy, etc.) replays the identical `POST` N times. Signature check only validates authenticity, never freshness/uniqueness — every replay passes and re-executes: `sendWhatsAppText()` re-sends the same reply to the real customer N times (visible spam + real API cost), `persistConversation()` appends duplicate message pairs into `conversations.messages`, `unified_messages` accumulates duplicate rows.
**Fix:** Add an early idempotency check against `message.id` before `buildAutoReply`/`sendWhatsAppText`/`persistConversation`, unconditionally (not gated behind the orchestration flag) — mirror the check already present in the orchestration path.

## Medium

### M1 — `lead_imports` RLS grants any authenticated user full read/write, including PII in `error_log`
**File:** `supabase/migrations/009_document_undocumented_production_objects.sql:197-200`
```sql
CREATE POLICY "Authenticated users manage imports" ON lead_imports FOR ALL TO authenticated USING (true);
```
**Exploit:** Same mechanism as H2 — any authenticated staff account reads all `lead_imports` rows directly via PostgREST, including `error_log` JSONB, which can contain raw customer PII from rows that failed validation during import.
**Fix:** Scope to `service_role` only, or add a role check as in H2.

### M2 — `leads_anon_insert` allows unrestricted, unauthenticated INSERT into `leads`
**File:** `supabase/migrations/005_stability_patch.sql:82-83`
```sql
CREATE POLICY "leads_anon_insert" ON leads FOR INSERT WITH CHECK (TRUE);
```
**Exploit:** Anyone with the public anon key (by definition public — `NEXT_PUBLIC_SUPABASE_ANON_KEY`) can `POST {SUPABASE_URL}/rest/v1/leads` directly with arbitrary field values, completely bypassing `/api/chat`'s rate limiting, AI validation, and sanitization. Enables lead-table spam/pollution/DoS at DB level, unthrottled.
**Fix:** Add a `WITH CHECK` constraint matching what the app enforces (e.g. required non-null `name`/`phone`, length caps), and/or route all inserts through `/api/chat` by removing anon INSERT and using the service-role key server-side only.

### M3 — `/api/health` unauthenticated, leaks internal schema/state
**File:** `src/app/api/health/route.ts` (no `requireAuth`/`requireRole` anywhere in the file)
**Exploit:** Any unauthenticated request to `GET /api/health` returns live `leads` row count, which internal tables exist/are queryable, RAG function status, knowledge-base chunk count, and AI/WhatsApp/Sheets provider configuration state (raw Postgres error messages on failure). Reconnaissance value for further attacks (confirms attack surface, provider misconfig windows).
**Fix:** Require auth, or strip to a minimal `{status: 'ok'}` for unauthenticated callers and gate the detailed `checks` object behind `requireRole(['admin'])`.

### M4 — `leads/import` bypasses the shared auth helper, uses `getSession()` instead of `getUser()`
**File:** `src/app/api/leads/import/route.ts:38-50` (POST), `:294-306` (GET)
```ts
const { data: { session } } = await supabase.auth.getSession()
if (!session) return 401
```
Every other route uses `requireAuth()` → `getCurrentUser()` → `supabase.auth.getUser()`, which re-verifies against the Supabase Auth server. `getSession()` only decodes the locally cached session and checks expiry — it will not be caught by the H1 fix (an `is_active` check added only to `auth-guard.ts` never runs on this route), and generally bypasses whatever the vetted helper does going forward.
**Fix:** Replace both handlers' inline check with `const auth = await requireAuth(); if (!auth.ok) return auth.response`.

### M5 — Supabase session cookies set `httpOnly: false`, no `secure` override
**File:** `src/lib/supabase-server.ts`, `src/lib/supabase-middleware.ts` — neither passes `cookieOptions` to `createServerClient()`; library default confirmed in `node_modules/@supabase/ssr/dist/index.js`: `{ sameSite: "lax", httpOnly: false, ... }`, no `secure` flag.
**Exploit:** Any XSS anywhere in an authenticated operator view lets an attacker run `document.cookie` and exfiltrate the `sb-access-token`/`sb-refresh-token` cookies to an external server — full session hijack outside the browser, no interaction with SameSite required (this is a script-read, not a cross-site request). Raises the stakes of any current or future escaping miss in operator-facing rendering.
**Fix:** At minimum explicitly set `cookieOptions: { secure: true, sameSite: 'lax' }`. `httpOnly: true` can't be safely flipped without an architecture change (the browser client reads the same cookie via `document.cookie`) — treat XSS elimination + a CSP as the primary mitigation for full session-cookie protection.

### M6 — CSRF: state-changing `GET` request protected only by `SameSite=Lax`
**File:** `src/app/api/proposals/[id]/invoice/route.ts:466-576` (`GET`)
This `GET` handler inserts a new `invoices` row (or updates `advance_received`/`balance_due`/`status`) and links `reservations.invoice_id` — guarded only by `requireAuth()`'s cookie check. No CSRF token, no `Origin`/`Referer` check.
**Exploit:** `SameSite=Lax` cookies (confirmed default, see M5) are sent on top-level GET navigations. An attacker who knows/obtains a proposal UUID (visible in dashboard URLs) gets a logged-in staff member to open `https://<crm-domain>/api/proposals/<uuid>/invoice` (a crafted link, phishing email, or auto-redirect) — the write executes silently with the staff session cookie attached, no confirmation step.
**Fix:** Move side effects to `POST`/`PATCH`, keep `GET` read-only; or add explicit `Origin`/`Sec-Fetch-Site` validation for state-changing GETs.

### M7 — Unescaped HTML injection via customer-controlled fields in transactional emails
**File:** `src/lib/email/templates.ts` — all 5 template functions (`proposalEmail`, `invoiceEmail`, `paymentReminderEmail`, `followUpEmail`, `bookingConfirmationEmail`), e.g. lines 70, 74, 112, 117, 157, 161, 195, 229, 233, 235
`data.clientName`/`data.eventType`/`data.venue` are interpolated directly into HTML strings with no escaping (contrast with `proposal-pdf.ts` and the invoice/receipt routes, which do escape). These values trace back to unauthenticated chat/WhatsApp lead intake — `src/lib/ai.ts`'s `sanitizeString()` (used for `lead.name` etc.) strips only control characters, not HTML metacharacters (confirmed by reading the function).
**Exploit:** A customer messages the public chatbot with a name containing `</td></tr></table><a href="http://phishing-site/pay">Updated payment link</a><table><tr><td>`. Once a proposal/invoice/booking-confirmation email is generated for that lead, the injected markup renders inside an otherwise-legitimate BookMySpaces email — usable for phishing/payment-redirection fraud.
**Fix:** Reuse the `escapeHtml()` helper already present in `proposal-pdf.ts` on every interpolated field in `templates.ts`.

### M8 — Outdated `xlsx` (SheetJS 0.18.5) parsing untrusted uploads; extension-only file-type check
**File:** `package.json:50` (`"xlsx": "^0.18.5"`), `src/lib/excel-parser.ts:110` (`XLSX.read`), `src/app/api/leads/import/route.ts:63-70` (extension check only, no magic-byte verification)
`xlsx@0.18.5` is the last npm-published version and carries the public prototype-pollution advisory (GHSA-4r6h-8v6p-xvw6) and a ReDoS advisory, both fixed only in SheetJS's own CDN-distributed builds, never released to npm.
**Exploit:** An authenticated staff member (this route requires a session, see M4) imports a crafted `.xlsx` renamed to pass the extension check from an external vendor/client — a routine workflow for this feature. `XLSX.read()` on the vulnerable version processes it, triggering prototype pollution or a ReDoS hang in the request-handling process.
**Fix:** Upgrade to the SheetJS CDN-distributed fixed build or migrate to a maintained parser (e.g. `exceljs`). Add a magic-byte check (`PK\x03\x04` for xlsx) before parsing regardless of extension.

### M9 — Social webhook: Lead Ads and Messenger/IG-DM events not deduped (replay)
**File:** `src/app/api/social/webhook/[platform]/route.ts:71-96`
Comment/mention ingestion (`ingestInteraction`) checks `!result.duplicate` before counting. The `leadgenEvents`/`messagingEvents` loops immediately below call `fetchLeadgenDetails`/`captureLeadWithJourney` and `captureSocialDirectMessage` with no equivalent check against `event.leadgenId`/`event.externalMessageId`.
**Exploit:** Replaying a captured, validly-signed `leadgen` or `messaging` payload re-runs lead capture and re-triggers `qualifyLeadFromMessage`/`runAutoPackageRecommendation` (AI-cost work) on every replay; if the form has no phone/email, each replay inserts a new duplicate `leads` row.
**Fix:** Add a dedup check keyed on `event.leadgenId`/`event.externalMessageId` before calling into capture logic, mirroring `ingestInteraction`'s pattern.

### M10 — Public unauthenticated proposal routes have no rate limiting
**Files:** `src/app/api/proposals/[id]/pdf/route.ts` (GET, HTML generation), `src/app/api/proposals/[id]/preview/route.ts:14-29` (GET — also unconditionally writes `status:'viewed'`/`viewed_at` on every hit), `src/app/api/proposals/track-view/route.ts:13-88` (POST, always returns 200 by design, 2 reads + 1 update per call), `src/app/api/proposal/share/[token]/route.ts:16-31` (GET) — all intentionally public per `SECURITY_REVIEW.md`, none call `checkRateLimit`.
**Exploit:** A proposal UUID or share token (leaked via referrer, forwarded link, screen-share) lets an attacker hit these routes in a tight loop: uncapped CPU/DB load on `/pdf`, corrupted "viewed" sales signal on `/preview`, and inflated `viewed_count`/`engagement_score` analytics on `/track-view` — with zero feedback since that route always returns 200 by design.
**Fix:** Apply the same `checkRateLimit`/`clientIpFrom` pattern already used in `chat/route.ts` and the webhook routes, generous enough for real customers but rejecting loop traffic.

## Context note (applies to all rate-limiting findings)
`src/lib/rate-limit.ts` is in-memory, per-process — its own header comment states the real ceiling on Vercel serverless (confirmed via `vercel.json`) is `limit × concurrent warm instances`, not a hard global cap. Every "has rate limiting" mitigation above is weaker than it looks for that reason; not a separate finding, but relevant context for prioritizing a Redis/Upstash-backed limiter if these routes see real abuse.

## Verified clean (checked, not reported)
IDOR sweep on `/api/customers/[id]`, `/api/reservations/[id]`, `/api/proposals/[id]/*`, `/api/leads/[id]/*` — flat-access-by-design per `SECURITY_REVIEW.md`, not a bug. `/api/admin/**` correctly gated by `requireRole`. SQL injection — no raw/string-built SQL found; all Supabase client calls parameterized, PostgREST filter-injection via `.or()`/`.ilike()` already sanitized with inline SECURITY comments. SSRF — no user-controlled URL ever reaches `fetch()`. Prompt injection — AI action space is a fixed typed set; pricing comes from a fixed catalog, never AI-generated; operator-assist output is display-only, no auto-write path found. CSP/CORS — no wildcard `Access-Control-Allow-Origin` anywhere. Secrets — no hardcoded live-looking secrets in `src/`/`scripts/`; `.env` files correctly gitignored, not tracked; no `error.stack` leaked in any API response; `logger.ts` redacts PII fields, no call site logs raw headers/tokens/payloads. Webhook verification order — both WhatsApp and Social check signature before any JSON parse or DB write; GET handshakes correctly compare `hub.verify_token` before reflecting `hub.challenge` (no arbitrary reflection).
