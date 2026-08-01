# MASTER_SECURITY.md — BookMySpaces Engineering OS

**Version:** v1.0 — READY FOR FREEZE

Canonical security reference. Consolidates `SECURITY_REVIEW.md`'s findings into standing policy, distinguishing what's fixed-and-should-stay-fixed from what's accepted risk requiring an environment-configuration discipline (not a code fix) forever.

## Authentication & Authorization model — understand this before touching any route

Every CRM-facing route goes through `requireAuth()`/`requireRole()` (`src/lib/auth-guard.ts`), backed by Supabase session cookies. **Critical architectural fact**: RLS is enabled on most tables, but most `authenticated`-role policies are unscoped (`USING (true)`). Authorization is enforced at the API layer, not by row-level security. This is a deliberate, consistent choice across the codebase (including migration 012's newer tables) — not a gap to "fix" by retrofitting RLS scoping, since that would be a significant architectural change requiring its own design and testing, not a drive-by hardening pass.

**The practical consequence for every future route**: RLS will not catch a route that forgets to call `requireAuth()`/`requireRole()`. Code review must treat "does this route call the auth guard" as a mandatory check, every time, for every new route — there is no database-level safety net behind it.

## Public-by-design routes — the complete list and why each is safe

See `MASTER_API.md`'s Public Allowlist table for the full list. Each has its own protection mechanism (capability token, HMAC signature, rate limiting) instead of session auth — restated here because security review of any new public route should confirm it has an equivalent, explicit protection mechanism, not just an absence of `requireAuth()`.

## Accepted risks — must-set environment variables, not code gaps

These are **known, unresolved-by-design** fail-open behaviors. They are not bugs to silently patch; they are operational requirements that must be enforced by deployment discipline, restated here as permanent OS policy because they will remain true unless the underlying code is deliberately changed (which the original review explicitly chose not to do, to avoid locking out legitimate cron/webhook traffic if a secret is misconfigured mid-rollout):

1. **`CRON_SECRET` unset → all `/api/cron/*` routes run with zero authentication.** This must be set in every environment, checked as part of every deployment checklist, forever. Any new cron route added by future work (multiple are planned in `docs/growth/`'s backlog) inherits this exact risk and must be added to the deployment checklist alongside the existing four.
2. **`WHATSAPP_APP_SECRET` unset → webhook signature verification silently no-ops** (`verifySignature()` returns `'unconfigured'`, the route only warns and still processes the request). Same must-set discipline as above.
3. Social webhook (`/api/social/webhook/[platform]`), by contrast, **fails closed** if its secret (`META_APP_SECRET`) is unset — `verifyWebhook()` returns `false`, the route responds 401. This asymmetry between WhatsApp and Social is a real, existing inconsistency worth knowing precisely (confirmed by direct code reading during the RC pass, correcting an earlier, wrong claim that both failed open) — do not assume both webhooks behave the same way.

## Logging hygiene — a real, partially-mitigated gap

`src/lib/logger.ts` redacts `phone`/`email`/`name` keys **only when passed inside the structured `data` object** of a log call. It does **not** scan message strings for PII interpolated directly into them (e.g. `` logger.error(`Failed for ${phone}`) ``). Roughly 9 such call sites were found and fixed across WhatsApp modules during the RC pass. **Standing rule for all future logging**: always pass identifying values (phone, email, name) via the `data` object, never interpolated into the message string — this is the only way the existing redaction mechanism actually protects them. This is a discipline requirement, not something the logger enforces automatically; code review should watch for it.

## Injection posture

- **SQL injection**: not applicable as a class of risk in this codebase — every query goes through Supabase's parameterized query builder or `.rpc()` with structured params; no raw/string-built SQL exists anywhere in `src`. Keep it that way — never construct a raw SQL string from user input, even inside a new RPC wrapper.
- **PostgREST filter injection**: a real, different, lower-severity class of issue — `.or()`'s filter-string syntax treats `,`/`(`/`)` as clause syntax. Two sites were found and fixed (`leads` search, AI knowledge retrieval). **Standing rule**: any code building a `.or()` filter string from user-supplied text must strip `,`, `(`, `)` from each interpolated value first — this is now an established, required pattern, not a one-time fix.
- **XSS**: `src/lib/proposal-pdf.ts` claimed complete HTML-escaping via its own `escapeHtml()` helper but had two real, unescaped interpolation sites (`room_type`, add-on `name`) found by not trusting the file's own header comment at face value. **Lesson for this OS, stated as policy**: a code comment claiming "this is already safe" is a claim to verify, not a fact to trust — this applies to every security-relevant claim in every document in this repository, including this one.

## CSRF

`next.config.js` restricts Server Actions to an explicit `allowedOrigins` list (`bookmyspaces.in`, `www.bookmyspaces.in`, `*.vercel.app`, localhost). Combined with cookie-based session auth (SameSite-protected by default) and session-required mutating routes, this is a reasonable, sufficient posture for this application's shape. No additional CSRF token layer exists or is currently deemed necessary.

## Secrets

No hardcoded API keys or secrets exist in `src` (verified by grep for common key patterns). `src/lib/env.ts` centralizes environment variable access — **no feature should read `process.env` directly**; route everything through this module so a future secrets-rotation or secrets-manager migration touches one file, not every feature.

## Security checklist for every new module (apply this to every `docs/growth/` module and beyond)

- [ ] Auth guard present on every non-allowlisted route, and the allowlist entry added to `MASTER_API.md` if genuinely public.
- [ ] zod schema + `parseBody()` on every input.
- [ ] Any new `.or()` filter built from user input is sanitized.
- [ ] Any new cron/webhook route's secret-verification failure mode (open vs. closed) is explicitly decided and documented, not left to default behavior.
- [ ] Any new logging call keeps PII in the `data` object, never interpolated into the message string.
- [ ] Any claim of "already handled" in a code comment is verified by reading the actual interpolation/query site, not trusted at face value.

## Assumptions recorded

- This document assumes the accepted-risk items (CRON_SECRET, WHATSAPP_APP_SECRET fail-open behavior) remain accepted risk rather than being code-fixed at some point without this document being updated to reflect that change. If either is ever changed to fail closed, this file must be updated in the same change.
