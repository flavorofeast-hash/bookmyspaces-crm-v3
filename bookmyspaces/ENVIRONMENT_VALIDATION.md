# ENVIRONMENT_VALIDATION.md — Go-Live Prep, Phase 3

Date: 2026-07-27. This working folder unexpectedly contains real environment files — `.env.local` and `.env.production.local` (the latter has every hallmark of a `vercel env pull --environment=production` snapshot: `VERCEL_GIT_*`, `VERCEL_ENV`, `TURBO_*` keys only present when pulled from an actual deployment). **Actual secret values in both files were pre-redacted before being placed in this environment** (production values all show as 2-character placeholders) — this report only inspects which variable *names* are present or absent, never any real value, and confirms this discipline was followed throughout.

## Method

For each file, listed variable names present, then checked each named variable against a set of "looks like a placeholder" patterns (`your-`, `YOUR_`, empty string) without ever printing the actual value — only whether it looked configured (by length) or not.

## Supabase

- `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — all three present, all three have real-length values (not placeholders).
- `.env.production.local`: all three keys present (values redacted to 2-char placeholders in this snapshot, so real production values can't be assessed for validity from here — only that Vercel has *something* configured under these names as of 2026-07-15).
- **Status: PASS** (local) / **NOT VERIFIED** (production value validity — key presence only).

## OpenAI

- `.env.local`: `OPENAI_API_KEY` present, real-length value.
- `.env.production.local`: key present (value redacted).
- **Status: PASS** (local) / **NOT VERIFIED** (production).

## Anthropic

- `.env.local`: `ANTHROPIC_API_KEY` present, real-length value.
- `.env.production.local`: key present (value redacted); also carries `ANTHROPIC_MODEL`, which isn't in `.env.example` or read anywhere obvious — likely a leftover from an earlier config approach, not a current requirement (the codebase's actual model selection goes through `src/lib/providers/ai-provider.ts` and Settings-table configuration per `AI_ARCHITECTURE.md`, not this env var).
- **Status: PASS** (local) / **NOT VERIFIED** (production).

## WhatsApp

- `.env.local`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` all present with real-length values. **`WHATSAPP_APP_SECRET` is absent from this file entirely** — not even as an empty placeholder, the key doesn't exist in `.env.local` at all.
- `.env.production.local`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` present (redacted values). **`WHATSAPP_APP_SECRET` is absent here too** — same conclusion from an independent source.
- **Status: FAIL.** Two independent snapshots (local dev env and a production `vercel env pull`) both lack `WHATSAPP_APP_SECRET` entirely as a key, not just an empty value. This corroborates every prior session's finding on this exact variable, now from direct file evidence rather than inference. Per `SECURITY_REVIEW.md`, this means the WhatsApp webhook currently accepts unsigned/forged requests in production. **This is the single highest-priority action item from this entire Go-Live pass.**

## Meta (Social — Facebook/Instagram)

- `.env.local`: none of `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_ID` present.
- `.env.production.local`: `META_VERIFY_TOKEN` present (redacted value) — the other four are absent.
- **Status: NOT CONFIGURED, and safe to remain so.** Unlike WhatsApp, `src/lib/social/adapters/meta-adapter.ts` fails **closed** without `META_APP_SECRET` (`verifyWebhook()` returns `false`, route responds 401) and the whole module is gated behind `isConfigured()`. Leaving Social unconfigured means that channel simply doesn't activate — not a security risk. These 5 variables were missing from `.env.example` itself until this pass (see `ENVIRONMENT_VARIABLES.md`'s new "Social — Meta Graph API" section, added this phase) — worth setting up before relying on Facebook/Instagram lead capture, but not a go-live blocker if that channel isn't launching yet.

## Google (Sheets sync)

- `.env.local`: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEETS_ID` all present as keys but **all three flagged as placeholder-looking** (matched the "your-"/empty heuristic) — Google Sheets sync is very likely not actually configured for local dev.
- `.env.production.local`: all three keys present (redacted values, can't assess).
- **Status: NOT VERIFIED / likely unconfigured locally.** Sheets sync degrades gracefully when unset (confirmed in `ENVIRONMENT_VARIABLES.md`), so this isn't a hard blocker, but worth a deliberate decision — is Sheets sync part of this launch or not.

## Email (Resend)

- `.env.local`: `RESEND_API_KEY`, `EMAIL_FROM` both present, real-length values.
- `.env.production.local`: **`RESEND_API_KEY` is absent entirely.** `EMAIL_FROM` also absent.
- **Status: FAIL for production.** Consistent with the app's own designed degradation (proposal-email falls back to `mailto:`, other email routes return a clear "not configured" message rather than crashing — confirmed in `ENVIRONMENT_VARIABLES.md`), so this doesn't break anything, but it does mean **no automated email currently sends in production** (invoices, payment reminders, follow-ups, booking confirmations) until this is set.

## Storage

- No dedicated storage-bucket environment variable exists in this codebase — corrected in this phase (see `INSTALL.md`/`DEPLOYMENT_CHECKLIST.md` corrections): knowledge base content lives in a `documents` Postgres table, not a Supabase Storage bucket. **Status: N/A, not a real requirement** (this report itself corrects a stale requirement stated in the prior pass's `INSTALL.md`).

## Cron

- `.env.local`: `CRON_SECRET` present, real-length (64-char) value.
- `.env.production.local`: **`CRON_SECRET` is absent entirely.**
- **Status: FAIL for production.** This is a new, more precise finding than the prior RC pass's — that pass correctly flagged `CRON_SECRET` as a "must-set, fails open if missing" item in the abstract; this phase's direct evidence from an actual production env snapshot shows it very likely genuinely *is* missing in production today. Combined with `WHATSAPP_APP_SECRET`, this is the second of two must-fix-before-launch items.

## Webhook secrets (cross-cutting summary)

| Secret | Local (`.env.local`) | Production snapshot (`.env.production.local`, 2026-07-15) |
|---|---|---|
| `WHATSAPP_APP_SECRET` | Absent | Absent |
| `META_APP_SECRET` | Absent | Absent (safe — fails closed) |
| `CRON_SECRET` | Present | Absent |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Present | Present (redacted) |

## Legacy/unused variables found live in the production snapshot

`.env.production.local` carries `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BUSINESS_PHONE`, `WATI_VERIFY_TOKEN`, `WATI_WEBHOOK_SECRET` — every one of these is explicitly listed in `.env.example`'s own "REMOVED" section as confirmed-unreferenced-in-code (ISS-029/ISS-038). Harmless (unused code paths don't read them), but real evidence of drift between what's configured in Vercel and what the current codebase needs — worth a cleanup pass in Vercel's env var settings at some point, not urgent.

## Caveat on this entire report

`.env.production.local` is a snapshot dated 2026-07-15 — **12 days old relative to today**. It is strong evidence, not proof, of the current production state. **Before acting on the FAIL items above, re-pull production env vars fresh** (`vercel env pull --environment=production`) to confirm they're still accurate, since some things could have changed in the interim. That said, `WHATSAPP_APP_SECRET` and `CRON_SECRET` being absent has now been independently corroborated by this snapshot, the prior RC pass's reasoning, and `audit/ENGINEERING_WORKSPACE_CURRENT_STATE.md` (2026-07-26) — three independent sources agreeing is stronger signal than any one alone, even with the snapshot's age.

## Summary

| Category | Status |
|---|---|
| Supabase | PASS (local) / NOT VERIFIED (production value validity) |
| OpenAI | PASS (local) / NOT VERIFIED (production) |
| Anthropic | PASS (local) / NOT VERIFIED (production) |
| WhatsApp | **FAIL** — `WHATSAPP_APP_SECRET` missing everywhere |
| Meta/Social | Not configured, safe to remain so (fails closed) |
| Google | NOT VERIFIED / likely unconfigured |
| Email | **FAIL** for production — `RESEND_API_KEY` missing |
| Storage | N/A — not a real requirement (corrected this phase) |
| Cron | **FAIL** for production — `CRON_SECRET` missing |
